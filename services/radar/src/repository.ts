import type {
  EnrichedItem,
  FeedItem,
  RadarEnv,
  RadarEventRow,
  SourceDefinition,
  StoredSourceItem,
} from "./contracts.ts";
import { stableHash } from "./quality.ts";
import { SOURCES } from "./sources.ts";

type SourceItemRow = {
  id: string;
  source_id: string;
  external_id: string;
  canonical_url: string;
  title_original: string;
  summary_original: string | null;
  language: string;
  content_hash: string;
  published_at: number;
  source_name: string;
  source_homepage: string;
  source_authority: number;
  source_official: number;
};

type ExistingSourceItemRow = {
  id: string;
  content_hash: string;
  processing_status: string;
  enrichment_attempts: number;
  next_retry_at: number | null;
};

export type EventEvidenceRow = {
  event_id?: string;
  source_name: string;
  canonical_url: string;
  title_original: string;
  support_kind: string;
};

export const MAX_ENRICHMENT_ATTEMPTS = 4;

export type EnrichmentAttemptClaim =
  | { state: "claimed"; attempts: number }
  | {
      state: "deferred" | "busy" | "terminal" | "missing";
      attempts: number;
      nextRetryAt: number | null;
      status: string;
    };

export type DeliverySubscription = {
  id: string;
  user_id: string;
  email: string;
  timezone: string;
  digest_hour: number;
  status: string;
  updated_at: number;
};

export type UserRankingProfile = {
  interests: string[];
  hidden: string[];
  verifiedOnly: boolean;
};

export async function seedSources(env: RadarEnv) {
  const now = Date.now();
  await env.DB.batch(
    SOURCES.map((source) =>
      env.DB.prepare(
        `INSERT INTO sources
          (id, name, kind, feed_url, homepage_url, region, language, authority, official, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           feed_url = excluded.feed_url,
           homepage_url = excluded.homepage_url,
           region = excluded.region,
           language = excluded.language,
           authority = excluded.authority,
           official = excluded.official,
           updated_at = excluded.updated_at`,
      ).bind(
        source.id,
        source.name,
        source.kind,
        source.feedUrl,
        source.homepageUrl,
        source.region,
        source.language,
        source.authority,
        source.official ? 1 : 0,
        now,
        now,
      ),
    ),
  );
}

export async function createPipelineRun(
  env: RadarEnv,
  stage: string,
  sourceId?: string,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO pipeline_runs (id, stage, status, source_id, processed_count, started_at)
     VALUES (?, ?, 'running', ?, 0, ?)`,
  )
    .bind(id, stage, sourceId ?? null, Date.now())
    .run();
  return id;
}

export async function finishPipelineRun(
  env: RadarEnv,
  id: string,
  status: "succeeded" | "failed",
  processedCount: number,
  errorCode?: string,
) {
  await env.DB.prepare(
    `UPDATE pipeline_runs SET status = ?, processed_count = ?, error_code = ?, finished_at = ? WHERE id = ?`,
  )
    .bind(status, processedCount, errorCode ?? null, Date.now(), id)
    .run();
}

export async function upsertSourceItem(
  env: RadarEnv,
  source: SourceDefinition,
  item: FeedItem,
  rawObjectKey: string | null,
) {
  const id = (await stableHash(`${source.id}|${item.externalId}`)).slice(0, 40);
  const contentHash = await stableHash(`${item.title}\n${item.summary}`);
  const existing = await env.DB.prepare(
    `SELECT id, content_hash, processing_status, enrichment_attempts, next_retry_at
     FROM source_items
     WHERE (source_id = ? AND external_id = ?) OR canonical_url = ?
     LIMIT 1`,
  )
    .bind(source.id, item.externalId, item.canonicalUrl)
    .first<ExistingSourceItemRow>();

  if (existing) {
    const unchanged = existing.content_hash === contentHash;
    if (!unchanged) {
      await env.DB.prepare(
        `UPDATE source_items SET
           title_original = ?, summary_original = ?, content_hash = ?,
           raw_object_key = COALESCE(?, raw_object_key), processing_status = 'pending',
           enrichment_attempts = 0, next_retry_at = NULL, last_error_code = NULL,
           published_at = ?
         WHERE id = ?`,
      )
        .bind(
          item.title,
          item.summary,
          contentHash,
          rawObjectKey,
          item.publishedAt,
          existing.id,
        )
        .run();
    }
    return {
      id: existing.id,
      needsProcessing:
        !unchanged ||
        (["pending", "failed", "processing"].includes(existing.processing_status) &&
          (existing.next_retry_at === null || existing.next_retry_at <= Date.now())),
    };
  }

  try {
    await env.DB.prepare(
      `INSERT INTO source_items
        (id, source_id, external_id, canonical_url, title_original, summary_original, language, content_hash, raw_object_key, processing_status, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(
        id,
        source.id,
        item.externalId,
        item.canonicalUrl,
        item.title,
        item.summary,
        source.language,
        contentHash,
        rawObjectKey,
        item.publishedAt,
        Date.now(),
      )
      .run();
    return { id, needsProcessing: true };
  } catch (error) {
    // A second queue consumer may have won the unique-key race. Read the winner
    // instead of turning a harmless duplicate into a failed pipeline run.
    const winner = await env.DB.prepare(
      `SELECT id, content_hash, processing_status, enrichment_attempts, next_retry_at
       FROM source_items
       WHERE (source_id = ? AND external_id = ?) OR canonical_url = ?
       LIMIT 1`,
    )
      .bind(source.id, item.externalId, item.canonicalUrl)
      .first<ExistingSourceItemRow>();
    if (winner) {
      return {
        id: winner.id,
        needsProcessing:
          winner.content_hash !== contentHash ||
          (["pending", "failed", "processing"].includes(winner.processing_status) &&
            (winner.next_retry_at === null || winner.next_retry_at <= Date.now())),
      };
    }
    throw error;
  }
}

export async function loadSourceItem(env: RadarEnv, sourceItemId: string) {
  const row = await env.DB.prepare(
    `SELECT
       si.id,
       si.source_id,
       si.external_id,
       si.canonical_url,
       si.title_original,
       si.summary_original,
       si.language,
       si.content_hash,
       si.published_at,
       s.name AS source_name,
       s.homepage_url AS source_homepage,
       s.authority AS source_authority,
       s.official AS source_official
     FROM source_items si
     JOIN sources s ON s.id = si.source_id
     WHERE si.id = ?`,
  )
    .bind(sourceItemId)
    .first<SourceItemRow>();
  if (!row) return null;
  const item: StoredSourceItem = {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    title: row.title_original,
    summary: row.summary_original ?? "",
    language: row.language,
    contentHash: row.content_hash,
    publishedAt: row.published_at,
    sourceName: row.source_name,
    sourceHomepage: row.source_homepage,
    sourceAuthority: row.source_authority,
    sourceOfficial: row.source_official === 1,
  };
  return item;
}

export async function markSourceItem(
  env: RadarEnv,
  sourceItemId: string,
  status: "enriched" | "quarantined" | "failed",
) {
  await env.DB.prepare(
    `UPDATE source_items
     SET processing_status = ?, next_retry_at = NULL,
         last_error_code = CASE WHEN ? = 'enriched' THEN NULL ELSE last_error_code END
     WHERE id = ?`,
  )
    .bind(status, status, sourceItemId)
    .run();
}

export async function claimEnrichmentAttempt(
  env: RadarEnv,
  sourceItemId: string,
  now = Date.now(),
): Promise<EnrichmentAttemptClaim> {
  const claimed = await env.DB.prepare(
    `UPDATE source_items
     SET processing_status = 'processing',
         enrichment_attempts = enrichment_attempts + 1,
         next_retry_at = ?,
         last_error_code = NULL
     WHERE id = ?
       AND enrichment_attempts < ?
       AND (
         (processing_status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= ?))
         OR (processing_status = 'processing' AND next_retry_at <= ?)
       )
     RETURNING enrichment_attempts AS attempts`,
  )
    .bind(now + 15 * 60 * 1000, sourceItemId, MAX_ENRICHMENT_ATTEMPTS, now, now)
    .first<{ attempts: number }>();
  if (claimed) return { state: "claimed", attempts: claimed.attempts };

  const row = await env.DB.prepare(
    `SELECT processing_status AS status, enrichment_attempts AS attempts,
            next_retry_at AS nextRetryAt
     FROM source_items WHERE id = ?`,
  )
    .bind(sourceItemId)
    .first<{ status: string; attempts: number; nextRetryAt: number | null }>();
  if (!row) {
    return { state: "missing", attempts: 0, nextRetryAt: null, status: "missing" };
  }
  if (
    row.attempts >= MAX_ENRICHMENT_ATTEMPTS &&
    !["enriched", "quarantined"].includes(row.status) &&
    (row.nextRetryAt === null || row.nextRetryAt <= now)
  ) {
    await env.DB.prepare(
      `UPDATE source_items
       SET processing_status = 'quarantined', next_retry_at = NULL,
           last_error_code = COALESCE(last_error_code, 'enrichment-attempts-exhausted')
       WHERE id = ? AND enrichment_attempts >= ?`,
    )
      .bind(sourceItemId, MAX_ENRICHMENT_ATTEMPTS)
      .run();
    return {
      state: "terminal",
      attempts: row.attempts,
      nextRetryAt: null,
      status: "quarantined",
    };
  }
  if (["enriched", "quarantined"].includes(row.status) || row.attempts >= MAX_ENRICHMENT_ATTEMPTS) {
    return { state: "terminal", ...row };
  }
  if (row.nextRetryAt !== null && row.nextRetryAt > now) {
    return { state: "deferred", ...row };
  }
  return { state: "busy", ...row };
}

function enrichmentBackoffSeconds(attempts: number) {
  return [60, 5 * 60, 30 * 60][Math.max(0, attempts - 1)] ?? 30 * 60;
}

export async function recordEnrichmentFailure(
  env: RadarEnv,
  sourceItemId: string,
  attempts: number,
  failureCode: string,
  now = Date.now(),
) {
  const terminal = attempts >= MAX_ENRICHMENT_ATTEMPTS;
  const delaySeconds = terminal ? 0 : enrichmentBackoffSeconds(attempts);
  const nextRetryAt = terminal ? null : now + delaySeconds * 1000;
  await env.DB.prepare(
    `UPDATE source_items
     SET processing_status = ?, next_retry_at = ?, last_error_code = ?
     WHERE id = ? AND processing_status = 'processing' AND enrichment_attempts = ?`,
  )
    .bind(
      terminal ? "quarantined" : "failed",
      nextRetryAt,
      failureCode.slice(0, 80),
      sourceItemId,
      attempts,
    )
    .run();
  return { terminal, delaySeconds, nextRetryAt };
}

export async function findEventByFingerprint(env: RadarEnv, fingerprint: string) {
  return env.DB.prepare(`SELECT id FROM events WHERE fingerprint = ?`)
    .bind(fingerprint)
    .first<{ id: string }>();
}

export async function findEventBySourceItem(env: RadarEnv, sourceItemId: string) {
  return env.DB.prepare(
    `SELECT event_id AS id FROM event_items WHERE source_item_id = ?`,
  )
    .bind(sourceItemId)
    .first<{ id: string }>();
}

export async function findMergeableEvent(
  env: RadarEnv,
  eventId: string,
  cutoff: number,
) {
  return env.DB.prepare(
    `SELECT id FROM events WHERE id = ? AND updated_at >= ?`,
  )
    .bind(eventId, cutoff)
    .first<{ id: string }>();
}

export async function saveEvent(
  env: RadarEnv,
  input: {
    id: string;
    slug: string;
    fingerprint: string;
    sourceItem: StoredSourceItem;
    enriched: EnrichedItem;
    status: string;
    confidence: number;
    trendScore: number;
    region: string;
    quarantined: boolean;
  },
) {
  if (
    input.enriched.translationState === "pending" ||
    input.enriched.promptInjectionDetected
  ) {
    throw new Error("invalid-evidence-state");
  }
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
    `INSERT INTO events
      (id, slug, fingerprint, title_zh, title_original, summary_zh, why_it_matters, status, confidence, trend_score, region, quarantined, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title_zh = CASE WHEN excluded.quarantined = 0 THEN excluded.title_zh ELSE events.title_zh END,
       summary_zh = CASE WHEN excluded.quarantined = 0 THEN excluded.summary_zh ELSE events.summary_zh END,
       why_it_matters = CASE WHEN excluded.quarantined = 0 THEN excluded.why_it_matters ELSE events.why_it_matters END,
       status = CASE
         WHEN excluded.quarantined = 0 AND excluded.confidence > events.confidence
         THEN excluded.status ELSE events.status END,
       confidence = CASE WHEN excluded.quarantined = 0
         THEN MAX(events.confidence, excluded.confidence) ELSE events.confidence END,
       trend_score = CASE WHEN excluded.quarantined = 0
         THEN MAX(events.trend_score, excluded.trend_score) ELSE events.trend_score END,
       quarantined = MIN(events.quarantined, excluded.quarantined),
       published_at = CASE WHEN excluded.quarantined = 0
         THEN MIN(events.published_at, excluded.published_at) ELSE events.published_at END,
       updated_at = excluded.updated_at`,
    ).bind(
      input.id,
      input.slug,
      input.fingerprint,
      input.enriched.titleZh,
      input.sourceItem.title,
      input.enriched.summaryZh,
      input.enriched.whyItMatters,
      input.status,
      input.confidence,
      input.trendScore,
      input.region,
      input.quarantined ? 1 : 0,
      input.sourceItem.publishedAt,
      now,
      now,
    ),
    env.DB.prepare(
    `INSERT INTO event_items (event_id, source_item_id, support_kind, created_at)
     VALUES (?, ?, 'supports', ?)
     ON CONFLICT(event_id, source_item_id) DO NOTHING`,
    ).bind(input.id, input.sourceItem.id, now),
    env.DB.prepare(
      `UPDATE source_items
       SET processing_status = ?, next_retry_at = NULL, last_error_code = NULL
       WHERE id = ?`,
    ).bind(input.quarantined ? "quarantined" : "enriched", input.sourceItem.id),
  ];

  if (!input.quarantined) {
    const normalizedTopics = new Map<string, string>();
    for (const topicName of input.enriched.topics) {
      const displayName = topicName.normalize("NFKC").trim().replace(/\s+/g, " ");
      const normalizedName = displayName.toLocaleLowerCase("en-US");
      if (displayName && !normalizedTopics.has(normalizedName)) {
        normalizedTopics.set(normalizedName, displayName);
      }
      if (normalizedTopics.size >= 12) break;
    }
    for (const [normalizedName, topicName] of normalizedTopics) {
      const topicId = `topic:${(await stableHash(normalizedName)).slice(0, 20)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO topics (id, name, kind, created_at) VALUES (?, ?, 'topic', ?)
           ON CONFLICT DO NOTHING`,
        ).bind(topicId, topicName, now),
        env.DB.prepare(
          `INSERT INTO event_topics (event_id, topic_id, relevance) VALUES (?, ?, 80)
           ON CONFLICT(event_id, topic_id) DO UPDATE SET relevance = MAX(event_topics.relevance, 80)`,
        ).bind(input.id, topicId),
      );
    }
  }
  await env.DB.batch(statements);
}

export async function listRadarEvents(env: RadarEnv, limit = 50) {
  const bounded = Math.max(1, Math.min(limit, 100));
  const result = await env.DB.prepare(
    `SELECT e.id, e.slug, e.title_zh, e.title_original, e.summary_zh,
            e.why_it_matters, e.status, e.confidence,
            MAX(0, e.trend_score - CAST(MAX(0, ? - e.published_at) / 86400000 AS INTEGER) * 3) AS trend_score,
            e.region,
            COALESCE(GROUP_CONCAT(t.name, ' '), '') AS topic_text,
            e.published_at, e.updated_at
     FROM events e
     LEFT JOIN event_topics et ON et.event_id = e.id
     LEFT JOIN topics t ON t.id = et.topic_id
     WHERE e.quarantined = 0
       AND EXISTS (
         SELECT 1 FROM event_items evidence
         JOIN source_items evidence_item ON evidence_item.id = evidence.source_item_id
         WHERE evidence.event_id = e.id AND evidence_item.processing_status = 'enriched'
       )
     GROUP BY e.id
     ORDER BY e.trend_score DESC, e.published_at DESC
     LIMIT ?`,
  )
    .bind(Date.now(), bounded)
    .all<RadarEventRow>();
  return result.results ?? [];
}

export async function getEvent(env: RadarEnv, eventId: string) {
  const event = await env.DB.prepare(
    `SELECT e.id, e.slug, e.title_zh, e.title_original, e.summary_zh,
            e.why_it_matters, e.status, e.confidence,
            MAX(0, e.trend_score - CAST(MAX(0, ? - e.published_at) / 86400000 AS INTEGER) * 3) AS trend_score,
            e.region,
            COALESCE(GROUP_CONCAT(t.name, ' '), '') AS topic_text,
            e.published_at, e.updated_at
     FROM events e
     LEFT JOIN event_topics et ON et.event_id = e.id
     LEFT JOIN topics t ON t.id = et.topic_id
     WHERE e.id = ? AND e.quarantined = 0
       AND EXISTS (
         SELECT 1 FROM event_items evidence
         JOIN source_items evidence_item ON evidence_item.id = evidence.source_item_id
         WHERE evidence.event_id = e.id AND evidence_item.processing_status = 'enriched'
       )
     GROUP BY e.id`,
  )
    .bind(Date.now(), eventId)
    .first<RadarEventRow>();
  if (!event) return null;
  const evidence = await env.DB.prepare(
    `SELECT s.name AS source_name, si.canonical_url, si.title_original, ei.support_kind
     FROM event_items ei
     JOIN source_items si ON si.id = ei.source_item_id
     JOIN sources s ON s.id = si.source_id
     WHERE ei.event_id = ? AND si.processing_status = 'enriched'
     ORDER BY s.authority DESC, si.published_at ASC`,
  )
    .bind(eventId)
    .all<EventEvidenceRow>();
  return { event, evidence: evidence.results ?? [] };
}

export async function listRadarEventDetails(env: RadarEnv, limit = 50) {
  const events = await listRadarEvents(env, limit);
  if (events.length === 0) return [];
  const placeholders = events.map(() => "?").join(", ");
  const evidenceResult = await env.DB.prepare(
    `SELECT ei.event_id, s.name AS source_name, si.canonical_url,
            si.title_original, ei.support_kind
     FROM event_items ei
     JOIN source_items si ON si.id = ei.source_item_id
     JOIN sources s ON s.id = si.source_id
     WHERE ei.event_id IN (${placeholders})
       AND si.processing_status = 'enriched'
     ORDER BY ei.event_id ASC, s.authority DESC, si.published_at ASC`,
  )
    .bind(...events.map((event) => event.id))
    .all<EventEvidenceRow & { event_id: string }>();
  const evidenceByEvent = new Map<string, EventEvidenceRow[]>();
  for (const row of evidenceResult.results ?? []) {
    const evidence = evidenceByEvent.get(row.event_id) ?? [];
    evidence.push({
      source_name: row.source_name,
      canonical_url: row.canonical_url,
      title_original: row.title_original,
      support_kind: row.support_kind,
    });
    evidenceByEvent.set(row.event_id, evidence);
  }
  return events.map((event) => ({
    event,
    evidence: evidenceByEvent.get(event.id) ?? [],
  }));
}

export async function listSubscriptions(
  env: RadarEnv,
  status: "pending" | "active",
  afterId = "",
  limit = 500,
) {
  const bounded = Math.max(1, Math.min(limit, 500));
  const result = await env.DB.prepare(
    `SELECT id, user_id, email, timezone, digest_hour, status, updated_at
     FROM subscriptions
     WHERE status = ? AND id > ?
     ORDER BY id ASC
     LIMIT ?`,
  )
    .bind(status, afterId, bounded)
    .all<DeliverySubscription>();
  return result.results ?? [];
}

export async function getSubscription(env: RadarEnv, subscriptionId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, email, timezone, digest_hour, status, updated_at
     FROM subscriptions WHERE id = ?`,
  )
    .bind(subscriptionId)
    .first<DeliverySubscription>();
}

export async function getActiveSubscriptionByTokenHash(
  env: RadarEnv,
  tokenHash: string,
) {
  return env.DB.prepare(
    `SELECT id, user_id, email, timezone, digest_hour, status, updated_at
     FROM subscriptions
     WHERE rss_token_hash = ? AND status IN ('active', 'rss_only')`,
  )
    .bind(tokenHash)
    .first<DeliverySubscription>();
}

export async function getUserInterests(env: RadarEnv, userId: string) {
  const result = await env.DB.prepare(
    `SELECT value FROM interests WHERE user_id = ? ORDER BY weight DESC, id ASC`,
  )
    .bind(userId)
    .all<{ value: string }>();
  return result.results?.map((row) => row.value) ?? [];
}

export async function getUserRankingProfile(
  env: RadarEnv,
  userId: string,
): Promise<UserRankingProfile> {
  const [interestResult, feedbackResult, user] = await Promise.all([
    env.DB.prepare(
      `SELECT value FROM interests WHERE user_id = ? ORDER BY weight DESC, id ASC`,
    )
      .bind(userId)
      .all<{ value: string }>(),
    env.DB.prepare(
      `SELECT signal_id FROM feedback
       WHERE user_id = ? AND action IN ('hide', 'less_like') AND active = 1`,
    )
      .bind(userId)
      .all<{ signal_id: string }>(),
    env.DB.prepare(`SELECT verified_only FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ verified_only: number }>(),
  ]);
  return {
    interests: interestResult.results?.map((row) => row.value) ?? [],
    hidden: feedbackResult.results?.map((row) => row.signal_id) ?? [],
    verifiedOnly: user?.verified_only === 1,
  };
}

export async function getEventEvidenceInputs(env: RadarEnv, eventId: string) {
  const result = await env.DB.prepare(
    `SELECT si.source_id, si.canonical_url, s.authority, s.official
     FROM event_items ei
     JOIN source_items si ON si.id = ei.source_item_id
     JOIN sources s ON s.id = si.source_id
     WHERE ei.event_id = ? AND si.processing_status = 'enriched'`,
  )
    .bind(eventId)
    .all<{
      source_id: string;
      canonical_url: string;
      authority: number;
      official: number;
    }>();
  return result.results ?? [];
}

export async function claimDelivery(
  env: RadarEnv,
  subscription: DeliverySubscription,
  channel: "confirmation" | "email",
  localDate: string,
) {
  const id = deliveryKey(subscription.user_id, localDate, channel);
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO deliveries
      (id, user_id, subscription_id, channel, local_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'sending', ?, ?)
     ON CONFLICT(user_id, local_date, channel) DO UPDATE SET
       status = 'sending', error_code = NULL, updated_at = excluded.updated_at
     WHERE deliveries.status = 'failed'
        OR (deliveries.status = 'sending' AND deliveries.updated_at < ?)
     RETURNING id`,
  )
    .bind(
      id,
      subscription.user_id,
      subscription.id,
      channel,
      localDate,
      now,
      now,
      now - 15 * 60 * 1000,
    )
    .first<{ id: string }>();
  return row?.id ?? null;
}

export function deliveryKey(
  userId: string,
  localDate: string,
  channel: "confirmation" | "email",
) {
  return `delivery:${userId}:${localDate}:${channel}`;
}

export async function finishDelivery(
  env: RadarEnv,
  deliveryId: string,
  input: { status: "sent" | "failed"; providerId?: string; errorCode?: string },
) {
  await env.DB.prepare(
    `UPDATE deliveries SET status = ?, provider_id = ?, error_code = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      input.status,
      input.providerId ?? null,
      input.errorCode ?? null,
      Date.now(),
      deliveryId,
    )
    .run();
}

export async function setSubscriptionStatus(
  env: RadarEnv,
  subscriptionId: string,
  status: "active" | "unsubscribed",
  revision: number,
) {
  await env.DB.prepare(
    `UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
  )
    .bind(status, Date.now(), subscriptionId, revision)
    .run();
}

export async function ensureTestSubscription(env: RadarEnv, email: string) {
  const emailHash = (await stableHash(email.toLowerCase())).slice(0, 24);
  const userId = `test:${emailHash}`;
  const subscriptionId = `sub:${userId}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
    ).bind(userId, email, now, now),
    env.DB.prepare(
      `INSERT INTO subscriptions
        (id, user_id, email, timezone, digest_hour, status, rss_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'Asia/Shanghai', 8, 'active', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email, status = 'active', updated_at = excluded.updated_at`,
    ).bind(
      subscriptionId,
      userId,
      email,
      await stableHash(`test-rss:${email}`),
      now,
      now,
    ),
  ]);
  const subscription: DeliverySubscription = {
    id: subscriptionId,
    user_id: userId,
    email,
    timezone: "Asia/Shanghai",
    digest_hour: 8,
    status: "active",
    updated_at: now,
  };
  return subscription;
}
