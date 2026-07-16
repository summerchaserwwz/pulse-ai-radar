import { rankByPreferences } from "../../../shared/ranking.ts";
import { createEmbedding, enrichItem } from "./ai.ts";
import { signSubscriptionAction } from "./auth.ts";
import type {
  DeliveryMessage,
  EnrichedItem,
  RadarEnv,
  RadarEventRow,
  StoredSourceItem,
} from "./contracts.ts";
import {
  buildConfirmationHtml,
  buildDigestHtml,
  sendResendEmail,
  type DigestEntry,
} from "./email.ts";
import { fetchSource, SourceFetchError } from "./feed.ts";
import {
  assessConfidence,
  clamp01,
  computeTrendScore,
  entityFingerprint,
  shouldQuarantine,
  stableHash,
} from "./quality.ts";
import {
  claimEnrichmentAttempt,
  claimDelivery,
  createPipelineRun,
  ensureTestSubscription,
  findEventByFingerprint,
  findEventBySourceItem,
  findMergeableEvent,
  finishDelivery,
  finishPipelineRun,
  getEventEvidenceInputs,
  getSubscription,
  getUserRankingProfile,
  listRadarEventDetails,
  listSubscriptions,
  loadSourceItem,
  markSourceItem,
  recordEnrichmentFailure,
  saveEvent,
  seedSources,
  upsertSourceItem,
  type DeliverySubscription,
} from "./repository.ts";
import { getSource, SOURCES } from "./sources.ts";

const DEFAULT_INTERESTS = ["基础模型", "Agent", "AI Coding", "开源模型"];

export class QueueRetryError extends Error {
  readonly delaySeconds: number;

  constructor(message: string, delaySeconds: number) {
    super(message);
    this.name = "QueueRetryError";
    this.delaySeconds = Math.max(1, Math.min(12 * 60 * 60, Math.ceil(delaySeconds)));
  }
}

export function queueRetryDelay(error: unknown) {
  return error instanceof QueueRetryError ? error.delaySeconds : 30;
}

function errorCode(error: unknown) {
  if (error instanceof SourceFetchError) return error.code;
  if (!(error instanceof Error)) return "unknown-error";
  return error.name === "Error" ? "pipeline-error" : error.name.slice(0, 80);
}

function appOrigin(env: RadarEnv) {
  if (!env.APP_ORIGIN) throw new Error("APP_ORIGIN 未配置");
  const url = new URL(env.APP_ORIGIN);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_ORIGIN 必须使用 HTTPS");
  }
  return url.origin;
}

function sourceHost(item: StoredSourceItem) {
  try {
    return new URL(item.canonicalUrl).hostname;
  } catch {
    return "invalid-source";
  }
}

function freshnessScore(publishedAt: number, now = Date.now()) {
  const ageHours = Math.max(0, now - publishedAt) / 3_600_000;
  return clamp01(1 - ageHours / 72);
}

function slugFor(eventId: string) {
  return `signal-${eventId.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase()}`;
}

async function semanticEventId(env: RadarEnv, embedding: number[] | null) {
  if (!embedding) return null;
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  const result = await env.EVENT_INDEX.query(embedding, {
    topK: 3,
    returnMetadata: true,
  });
  for (const match of result.matches) {
    const eventId = match.metadata?.eventId;
    const publishedAt = match.metadata?.publishedAt;
    if (
      match.score < 0.88 ||
      typeof eventId !== "string" ||
      eventId.length > 100 ||
      typeof publishedAt !== "number" ||
      publishedAt < cutoff
    ) {
      continue;
    }
    const candidate = await findMergeableEvent(env, eventId, cutoff);
    if (candidate) return candidate.id;
  }
  return null;
}

export async function processSourceFetch(env: RadarEnv, sourceId: string) {
  const runId = await createPipelineRun(env, "source-fetch", sourceId);
  try {
    const source = getSource(sourceId);
    if (!source) throw new Error("未知来源");
    const fetched = await fetchSource(source);
    let rawObjectKey: string | null = null;
    if (source.snapshotAllowed) {
      const date = new Date().toISOString().slice(0, 10);
      rawObjectKey = `feed-snapshots/${source.id}/${date}/${fetched.contentHash}.xml`;
      await env.RAW_BUCKET.put(rawObjectKey, fetched.xml, {
        httpMetadata: { contentType: "application/xml; charset=utf-8" },
        customMetadata: {
          sourceId: source.id,
          fetchedUrl: fetched.fetchedUrl,
          fetchedAt: new Date().toISOString(),
        },
      });
    }

    const queueMessages: Array<{ body: { kind: "item-enrich"; sourceItemId: string } }> = [];
    for (const item of fetched.items) {
      const stored = await upsertSourceItem(env, source, item, rawObjectKey);
      if (stored.needsProcessing) {
        queueMessages.push({ body: { kind: "item-enrich", sourceItemId: stored.id } });
      }
    }
    if (queueMessages.length > 0) await env.ITEM_ENRICH_QUEUE.sendBatch(queueMessages);
    await env.DB.prepare(`UPDATE sources SET last_fetched_at = ?, updated_at = ? WHERE id = ?`)
      .bind(Date.now(), Date.now(), source.id)
      .run();
    await finishPipelineRun(env, runId, "succeeded", fetched.items.length);
    return { fetched: fetched.items.length, queued: queueMessages.length };
  } catch (error) {
    const code = errorCode(error);
    await finishPipelineRun(env, runId, "failed", 0, code);
    if (error instanceof SourceFetchError) {
      // Cron 每 5 分钟会重新调度来源。预期的 HTTP、大小和网络错误不在
      // Queue 内 30 秒热重试，避免对 403/429 源站放大流量。
      return { fetched: 0, queued: 0, skipped: true, errorCode: code };
    }
    throw error;
  }
}

export async function processItemEnrichment(env: RadarEnv, sourceItemId: string) {
  const runId = await createPipelineRun(env, "item-enrich");
  const claim = await claimEnrichmentAttempt(env, sourceItemId);
  if (claim.state !== "claimed") {
    if (claim.state === "deferred") {
      const delaySeconds = Math.max(
        1,
        Math.ceil(((claim.nextRetryAt ?? Date.now()) - Date.now()) / 1000),
      );
      await finishPipelineRun(env, runId, "failed", 0, "enrichment-deferred");
      throw new QueueRetryError("enrichment-deferred", delaySeconds);
    }
    await finishPipelineRun(env, runId, "succeeded", 0);
    return { queued: false, skipped: claim.state };
  }

  const failAttempt = async (failureCode: string) => {
    const failure = await recordEnrichmentFailure(
      env,
      sourceItemId,
      claim.attempts,
      failureCode,
    );
    if (failure.terminal) {
      await finishPipelineRun(env, runId, "succeeded", 1, "enrichment-quarantined");
      return { queued: false, quarantined: true, attempts: claim.attempts };
    }
    await finishPipelineRun(env, runId, "failed", 0, failureCode);
    throw new QueueRetryError(failureCode, failure.delaySeconds);
  };

  try {
    const item = await loadSourceItem(env, sourceItemId);
    if (!item) {
      await finishPipelineRun(env, runId, "succeeded", 0);
      return { queued: false };
    }
    const enriched = await enrichItem(env, item);
    if (enriched.promptInjectionDetected) {
      await markSourceItem(env, sourceItemId, "quarantined");
      await finishPipelineRun(env, runId, "succeeded", 1, "prompt-injection");
      return { queued: false, quarantined: true, reason: "prompt-injection" };
    }
    if (enriched.translationState === "pending") {
      return await failAttempt("invalid-enrichment-output");
    }
    await env.EVENT_CLUSTER_QUEUE.send({
      kind: "event-cluster",
      sourceItemId,
      enriched,
    });
    await finishPipelineRun(env, runId, "succeeded", 1);
    return {
      queued: true,
      translationState: enriched.translationState,
      attempts: claim.attempts,
    };
  } catch (error) {
    if (error instanceof QueueRetryError) throw error;
    return await failAttempt(errorCode(error));
  }
}

function evidenceFor(item: StoredSourceItem) {
  return {
    sourceId: item.sourceId,
    hostname: sourceHost(item),
    official: item.sourceOfficial,
    authority: item.sourceAuthority,
  };
}

export async function processEventCluster(
  env: RadarEnv,
  sourceItemId: string,
  enriched: EnrichedItem,
) {
  const runId = await createPipelineRun(env, "event-cluster");
  let eventCommitted = false;
  try {
    const item = await loadSourceItem(env, sourceItemId);
    if (!item) {
      await finishPipelineRun(env, runId, "succeeded", 0);
      return { saved: false };
    }

    if (enriched.translationState === "pending" || enriched.promptInjectionDetected) {
      await markSourceItem(env, sourceItemId, "quarantined");
      await finishPipelineRun(env, runId, "succeeded", 1, "invalid-evidence-state");
      return { saved: false, quarantined: true };
    }

    const fingerprintBase = entityFingerprint(
      `${enriched.entities.join(" ")} ${enriched.titleZh || item.title}`,
    );
    const fingerprint =
      fingerprintBase || (await stableHash(item.canonicalUrl)).slice(0, 48);
    const [mapped, exact] = await Promise.all([
      findEventBySourceItem(env, sourceItemId),
      findEventByFingerprint(env, fingerprint),
    ]);
    const embedding = await createEmbedding(env, `${enriched.titleZh}\n${enriched.summaryZh}`);
    const existingEventId = mapped?.id ?? exact?.id ?? (await semanticEventId(env, embedding));

    const priorEvidence = existingEventId
      ? await getEventEvidenceInputs(env, existingEventId)
      : [];
    const evidence = priorEvidence.map((row) => ({
      sourceId: row.source_id,
      hostname: (() => {
        try {
          return new URL(row.canonical_url).hostname;
        } catch {
          return "invalid-source";
        }
      })(),
      official: row.official === 1,
      authority: row.authority,
    }));
    if (!evidence.some((candidate) => candidate.sourceId === item.sourceId)) {
      evidence.push(evidenceFor(item));
    }

    const confidenceAssessment = assessConfidence(evidence);
    let status = confidenceAssessment.status;
    let confidence = confidenceAssessment.score;
    if (
      enriched.impact === "high" &&
      !confidenceAssessment.hasPrimary &&
      confidenceAssessment.independentSources < 2
    ) {
      status = "待核实";
      confidence = Math.min(confidence, 54);
    }
    const authorityAverage =
      evidence.reduce((sum, candidate) => sum + candidate.authority / 100, 0) /
      Math.max(evidence.length, 1);
    const trendScore = computeTrendScore({
      freshness: freshnessScore(item.publishedAt),
      velocity: clamp01(evidence.length / 4),
      authority: authorityAverage,
      corroboration: clamp01(confidenceAssessment.independentSources / 3),
      interestMatch: 0.5,
    });
    const quarantined = shouldQuarantine({
      confidence,
      status,
      promptInjectionDetected: enriched.promptInjectionDetected,
      translationState: enriched.translationState,
    });

    const eventId =
      existingEventId ?? `event:${(await stableHash(`${fingerprint}|${item.publishedAt}`)).slice(0, 32)}`;
    await saveEvent(env, {
      id: eventId,
      slug: slugFor(eventId),
      fingerprint,
      sourceItem: item,
      enriched,
      status,
      confidence,
      trendScore,
      region: getSource(item.sourceId)?.region ?? "全球",
      quarantined,
    });
    eventCommitted = true;

    if (embedding && !quarantined) {
      await env.EVENT_INDEX.upsert([
        {
          id: eventId,
          values: embedding,
          metadata: {
            eventId,
            publishedAt: item.publishedAt,
            quarantined,
          },
        },
      ]);
    }
    await finishPipelineRun(env, runId, "succeeded", 1);
    return { saved: true, eventId, quarantined, confidence, trendScore };
  } catch (error) {
    if (!eventCommitted) await markSourceItem(env, sourceItemId, "failed");
    await finishPipelineRun(env, runId, "failed", 0, errorCode(error));
    throw error;
  }
}

function localSchedule(now: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(now))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export async function personalizedEntries(env: RadarEnv, userId: string, limit = 7) {
  const [details, profile] = await Promise.all([
    listRadarEventDetails(env, 60),
    getUserRankingProfile(env, userId),
  ]);
  return rankByPreferences(details.filter((detail) => detail.evidence.length > 0), {
    interests: profile.interests.length ? profile.interests : DEFAULT_INTERESTS,
    hidden: profile.hidden,
    verifiedOnly: profile.verifiedOnly,
    limit,
    id: (entry) => entry.event.id,
    text: (entry) =>
      `${entry.event.title_zh} ${entry.event.summary_zh} ${entry.event.topic_text}`,
    baseScore: (entry) => entry.event.trend_score,
    evidenceCount: (entry) => entry.evidence.length,
    status: (entry) => entry.event.status,
  }) as DigestEntry[];
}

async function confirmationDelivery(
  env: RadarEnv,
  subscription: DeliverySubscription,
  deliveryDate: string,
) {
  const deliveryId = await claimDelivery(env, subscription, "confirmation", deliveryDate);
  if (!deliveryId) return false;
  try {
    const origin = appOrigin(env);
    const [confirmToken, unsubscribeToken] = await Promise.all([
      signSubscriptionAction(env, {
        subscriptionId: subscription.id,
        action: "confirm",
        revision: subscription.updated_at,
      }),
      signSubscriptionAction(env, {
        subscriptionId: subscription.id,
        action: "unsubscribe",
        revision: subscription.updated_at,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }),
    ]);
    const html = buildConfirmationHtml({
      confirmUrl: `${origin}/api/subscriptions/confirm?token=${encodeURIComponent(confirmToken)}`,
      unsubscribeUrl: `${origin}/api/subscriptions/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
    });
    const providerId = await sendResendEmail(env, {
      to: subscription.email,
      subject: "确认订阅 PULSE/AI 个人情报日报",
      html,
      idempotencyKey: deliveryId,
    });
    await finishDelivery(env, deliveryId, { status: "sent", providerId });
    return true;
  } catch (error) {
    await finishDelivery(env, deliveryId, { status: "failed", errorCode: errorCode(error) });
    throw error;
  }
}

async function dailyDelivery(
  env: RadarEnv,
  subscription: DeliverySubscription,
  localDate: string,
) {
  const entries = await personalizedEntries(env, subscription.user_id);
  if (entries.length === 0) return false;
  const deliveryId = await claimDelivery(env, subscription, "email", localDate);
  if (!deliveryId) return false;
  try {
    const origin = appOrigin(env);
    const profile = await getUserRankingProfile(env, subscription.user_id);
    const unsubscribeToken = await signSubscriptionAction(env, {
      subscriptionId: subscription.id,
      action: "unsubscribe",
      revision: subscription.updated_at,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
    const unsubscribeUrl = `${origin}/api/subscriptions/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
    const html = buildDigestHtml({
      entries,
      localDate,
      interests: profile.interests.length ? profile.interests : DEFAULT_INTERESTS,
      unsubscribeUrl,
      appOrigin: origin,
    });
    const providerId = await sendResendEmail(env, {
      to: subscription.email,
      subject: `${localDate} · PULSE/AI 每日情报简报`,
      html,
      idempotencyKey: deliveryId,
      emailHeaders: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await finishDelivery(env, deliveryId, { status: "sent", providerId });
    return true;
  } catch (error) {
    await finishDelivery(env, deliveryId, { status: "failed", errorCode: errorCode(error) });
    throw error;
  }
}

export async function processDelivery(env: RadarEnv, message: DeliveryMessage) {
  const runId = await createPipelineRun(env, `delivery:${message.deliveryKind}`);
  try {
    const subscription = await getSubscription(env, message.subscriptionId);
    if (!subscription) {
      await finishPipelineRun(env, runId, "succeeded", 0);
      return { sent: 0, skipped: "subscription-not-found" };
    }
    const expectedStatus = message.deliveryKind === "confirmation" ? "pending" : "active";
    if (subscription.status !== expectedStatus) {
      await finishPipelineRun(env, runId, "succeeded", 0);
      return { sent: 0, skipped: "subscription-state-changed" };
    }
    const sent = message.deliveryKind === "confirmation"
      ? await confirmationDelivery(env, subscription, message.localDate)
      : await dailyDelivery(env, subscription, message.localDate);
    await finishPipelineRun(env, runId, "succeeded", sent ? 1 : 0);
    return { sent: sent ? 1 : 0, considered: 1 };
  } catch (error) {
    await finishPipelineRun(env, runId, "failed", 0, errorCode(error));
    throw error;
  }
}

async function allSubscriptions(env: RadarEnv, status: "pending" | "active") {
  const subscriptions: DeliverySubscription[] = [];
  let cursor = "";
  for (;;) {
    const page = await listSubscriptions(env, status, cursor, 500);
    subscriptions.push(...page);
    if (page.length < 500) return subscriptions;
    cursor = page[page.length - 1].id;
  }
}

async function sendDeliveryMessages(
  env: RadarEnv,
  messages: Array<{ body: DeliveryMessage }>,
) {
  for (let index = 0; index < messages.length; index += 100) {
    await env.DELIVERY_QUEUE.sendBatch(messages.slice(index, index + 100));
  }
}

export async function schedulePipeline(env: RadarEnv, scheduledAt = Date.now()) {
  await seedSources(env);
  const sourceMessages = SOURCES.map((source) => ({
    body: { kind: "source-fetch" as const, sourceId: source.id },
  }));
  await env.SOURCE_FETCH_QUEUE.sendBatch(sourceMessages);
  const [pending, active] = await Promise.all([
    allSubscriptions(env, "pending"),
    allSubscriptions(env, "active"),
  ]);
  const deliveryMessages: Array<{ body: DeliveryMessage }> = pending.map((subscription) => ({
    body: {
      kind: "delivery",
      deliveryKind: "confirmation",
      subscriptionId: subscription.id,
      localDate: `confirm:${subscription.updated_at}`,
    },
  }));
  for (const subscription of active) {
    try {
      const schedule = localSchedule(scheduledAt, subscription.timezone);
      if (schedule.hour !== subscription.digest_hour) continue;
      deliveryMessages.push({
        body: {
          kind: "delivery",
          deliveryKind: "daily",
          subscriptionId: subscription.id,
          localDate: schedule.localDate,
        },
      });
    } catch {
      // Invalid timezones are rejected on write; legacy invalid rows are skipped.
    }
  }
  await sendDeliveryMessages(env, deliveryMessages);
  return { sources: sourceMessages.length, deliveries: deliveryMessages.length };
}

export async function sendConfiguredTestDelivery(env: RadarEnv) {
  if (!env.TEST_RECIPIENT) throw new Error("TEST_RECIPIENT 未配置");
  const subscription = await ensureTestSubscription(env, env.TEST_RECIPIENT);
  const entries = await personalizedEntries(env, subscription.user_id, 5);
  if (entries.length === 0) throw new Error("没有可投递且带来源证据的事件");
  const localDate = `test:${new Date().toISOString().slice(0, 13)}`;
  const deliveryId = await claimDelivery(env, subscription, "email", localDate);
  if (!deliveryId) throw new Error("本小时测试投递已完成，未重复发送");
  try {
    const origin = appOrigin(env);
    const unsubscribeToken = await signSubscriptionAction(env, {
      subscriptionId: subscription.id,
      action: "unsubscribe",
      revision: subscription.updated_at,
    });
    const html = buildDigestHtml({
      entries,
      localDate,
      interests: DEFAULT_INTERESTS,
      unsubscribeUrl: `${origin}/api/subscriptions/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
      appOrigin: origin,
    });
    const providerId = await sendResendEmail(env, {
      to: subscription.email,
      subject: "PULSE/AI · 生产联调测试投递",
      html,
      idempotencyKey: deliveryId,
    });
    await finishDelivery(env, deliveryId, { status: "sent", providerId });
    return { deliveryId, providerId, recipient: subscription.email };
  } catch (error) {
    await finishDelivery(env, deliveryId, { status: "failed", errorCode: errorCode(error) });
    throw error;
  }
}

export type PublicRadarEvent = RadarEventRow & {
  sources: Array<{
    name: string;
    url: string;
    titleOriginal: string;
    supportKind: string;
  }>;
};

export async function publicRadarEvents(env: RadarEnv, limit: number, offset = 0) {
  const details = await listRadarEventDetails(env, limit, offset);
  return details.map(
    ({ event, evidence }): PublicRadarEvent => ({
        ...event,
        sources: evidence.map((source) => ({
          name: source.source_name,
          url: source.canonical_url,
          titleOriginal: source.title_original,
          supportKind: source.support_kind,
        })),
      }),
  );
}
