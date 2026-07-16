import { verifySubscriptionAction } from "./auth.ts";
import type { EnrichedItem, RadarEnv, RadarQueueMessage } from "./contracts.ts";
import {
  processDelivery,
  processEventCluster,
  processItemEnrichment,
  processSourceFetch,
  publicRadarEvents,
  queueRetryDelay,
  schedulePipeline,
  sendConfiguredTestDelivery,
} from "./pipeline.ts";
import { countRadarEvents, getEvent, setSubscriptionStatus } from "./repository.ts";
import { privateRssResponse } from "./rss.ts";
import { SOURCES } from "./sources.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEnrichedItem(value: unknown): value is EnrichedItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.titleZh === "string" &&
    typeof value.summaryZh === "string" &&
    typeof value.whyItMatters === "string" &&
    Array.isArray(value.entities) &&
    value.entities.every((entry) => typeof entry === "string") &&
    Array.isArray(value.topics) &&
    value.topics.every((entry) => typeof entry === "string") &&
    ["high", "medium", "low"].includes(String(value.impact)) &&
    ["translated", "original_zh", "pending"].includes(String(value.translationState)) &&
    typeof value.promptInjectionDetected === "boolean"
  );
}

function validQueueMessage(value: unknown): value is RadarQueueMessage {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "source-fetch") return typeof value.sourceId === "string";
  if (value.kind === "item-enrich") return typeof value.sourceItemId === "string";
  if (value.kind === "event-cluster") {
    return typeof value.sourceItemId === "string" && isEnrichedItem(value.enriched);
  }
  if (value.kind === "delivery") {
    return (
      (value.deliveryKind === "confirmation" || value.deliveryKind === "daily") &&
      typeof value.subscriptionId === "string" &&
      value.subscriptionId.length > 0 &&
      value.subscriptionId.length <= 160 &&
      typeof value.localDate === "string" &&
      value.localDate.length > 0 &&
      value.localDate.length <= 80
    );
  }
  return false;
}

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function withCors(response: Response, request: Request, env: RadarEnv) {
  const origin = request.headers.get("origin");
  if (!origin || !env.APP_ORIGIN) return response;
  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(env.APP_ORIGIN).origin;
  } catch {
    return response;
  }
  if (origin !== allowedOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-max-age", "86400");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function authorizedAdmin(request: Request, env: RadarEnv) {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 24) return false;
  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

function appRedirect(env: RadarEnv, state: "confirmed" | "unsubscribed" | "invalid") {
  try {
    const origin = new URL(env.APP_ORIGIN ?? "https://example.invalid").origin;
    return Response.redirect(`${origin}/?subscription=${state}`, 303);
  } catch {
    return json({ state }, { status: state === "invalid" ? 400 : 200 });
  }
}

async function subscriptionAction(
  request: Request,
  env: RadarEnv,
  action: "confirm" | "unsubscribe",
) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (request.method === "GET") {
    try {
      const origin = new URL(env.APP_ORIGIN ?? "").origin;
      return Response.redirect(
        `${origin}/api/subscriptions/${action}?token=${encodeURIComponent(token)}`,
        303,
      );
    } catch {
      return json({ error: "APP_ORIGIN 未配置" }, { status: 503 });
    }
  }
  const payload = await verifySubscriptionAction(env, token, action);
  if (!payload) return appRedirect(env, "invalid");
  await setSubscriptionStatus(
    env,
    payload.subscriptionId,
    action === "confirm" ? "active" : "unsubscribed",
    payload.revision,
  );
  return appRedirect(env, action === "confirm" ? "confirmed" : "unsubscribed");
}

async function fetchHandler(request: Request, env: RadarEnv) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      status: "ok",
      service: "pulse-ai-radar",
      sourceCount: SOURCES.length,
      bindings: {
        d1: Boolean(env.DB),
        r2: Boolean(env.RAW_BUCKET),
        vectorize: Boolean(env.EVENT_INDEX),
        ai: Boolean(env.AI),
        queues: Boolean(
          env.SOURCE_FETCH_QUEUE &&
            env.ITEM_ENRICH_QUEUE &&
            env.EVENT_CLUSTER_QUEUE &&
            env.DELIVERY_QUEUE,
        ),
        email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
        signing: Boolean(env.AUTH_SIGNING_KEY),
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/sources") {
    return json({
      sources: SOURCES.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        feedUrl: source.feedUrl,
        homepageUrl: source.homepageUrl,
        region: source.region,
        language: source.language,
        authority: source.authority,
        official: source.official,
        snapshotAllowed: source.snapshotAllowed,
      })),
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/radar") {
    const requested = Number(url.searchParams.get("limit") ?? "30");
    const requestedOffset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.floor(requested))) : 30;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;
    const [rows, total] = await Promise.all([
      publicRadarEvents(env, limit + 1, offset),
      countRadarEvents(env),
    ]);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    return json({
      events,
      page: {
        offset,
        nextOffset: hasMore ? offset + events.length : null,
        hasMore,
        total,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/events/")) {
    const eventId = decodeURIComponent(url.pathname.slice("/v1/events/".length));
    if (!eventId || eventId.length > 120) return json({ error: "事件 id 无效" }, { status: 400 });
    const detail = await getEvent(env, eventId);
    return detail ? json(detail) : json({ error: "事件不存在" }, { status: 404 });
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/rss.xml" || url.pathname === "/v1/rss.xml")
  ) {
    return privateRssResponse(env, request);
  }

  if (
    (request.method === "GET" || request.method === "POST") &&
    url.pathname === "/v1/subscriptions/confirm"
  ) {
    return subscriptionAction(request, env, "confirm");
  }
  if (
    (request.method === "GET" || request.method === "POST") &&
    url.pathname === "/v1/subscriptions/unsubscribe"
  ) {
    return subscriptionAction(request, env, "unsubscribe");
  }

  if (request.method === "POST" && url.pathname === "/v1/admin/schedule") {
    if (!authorizedAdmin(request, env)) return json({ error: "未授权" }, { status: 401 });
    return json(await schedulePipeline(env));
  }
  if (request.method === "POST" && url.pathname === "/v1/admin/test-delivery") {
    if (!authorizedAdmin(request, env)) return json({ error: "未授权" }, { status: 401 });
    return json(await sendConfiguredTestDelivery(env));
  }

  return json({ error: "接口不存在" }, { status: 404 });
}

async function processMessage(env: RadarEnv, message: RadarQueueMessage) {
  switch (message.kind) {
    case "source-fetch":
      return processSourceFetch(env, message.sourceId);
    case "item-enrich":
      return processItemEnrichment(env, message.sourceItemId);
    case "event-cluster":
      return processEventCluster(env, message.sourceItemId, message.enriched);
    case "delivery":
      return processDelivery(env, message);
  }
}

const worker = {
  async fetch(request: Request, env: RadarEnv) {
    try {
      return withCors(await fetchHandler(request, env), request, env);
    } catch {
      const requestId = crypto.randomUUID();
      return withCors(
        json({ error: "服务暂时不可用", code: "internal_error", requestId }, { status: 500 }),
        request,
        env,
      );
    }
  },

  async scheduled(controller: ScheduledController, env: RadarEnv, context: ExecutionContext) {
    context.waitUntil(schedulePipeline(env, controller.scheduledTime));
  },

  async queue(batch: MessageBatch<unknown>, env: RadarEnv) {
    for (const message of batch.messages) {
      if (!validQueueMessage(message.body)) {
        message.ack();
        continue;
      }
      try {
        await processMessage(env, message.body);
        message.ack();
      } catch (error) {
        message.retry({ delaySeconds: queueRetryDelay(error) });
      }
    }
  },
};

export default worker;
