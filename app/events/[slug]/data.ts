import { cache } from "react";
import { env } from "cloudflare:workers";
import { loadLiveSignals } from "@/app/api/_lib/radar";
import { signals, type Signal } from "@/shared/signals";

type EventIdentityRow = {
  id: string;
};

function validSlug(slug: string) {
  return slug.length > 0 && slug.length <= 160 && !/[\u0000-\u001f]/.test(slug);
}

/**
 * Public event pages keep the historical demo set addressable even before the
 * ingestion worker has produced live rows. Live slugs resolve through D1 and
 * then reuse the same public signal mapper as the radar API, so the website,
 * RSS and indexable detail pages do not drift into different content models.
 */
export const loadPublicSignal = cache(async (slug: string): Promise<Signal | null> => {
  if (!validSlug(slug)) return null;

  const demo = signals.find((signal) => signal.id === slug);
  if (demo) return { ...demo, dataMode: "demo" };

  if (!env.DB) return null;

  try {
    const identity = await env.DB.prepare(
      `SELECT id
       FROM events
       WHERE slug = ? AND quarantined = 0
         AND EXISTS (
           SELECT 1 FROM event_items evidence
           JOIN source_items evidence_item ON evidence_item.id = evidence.source_item_id
           WHERE evidence.event_id = events.id
             AND evidence_item.processing_status = 'enriched'
         )
       LIMIT 1`,
    )
      .bind(slug)
      .first<EventIdentityRow>();
    if (!identity) return null;

    const liveSignals = await loadLiveSignals(env.DB, 100);
    return liveSignals.find((signal) => signal.id === identity.id) ?? null;
  } catch {
    return null;
  }
});

export function eventCanonicalPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}`;
}

export function eventCanonicalUrl(slug: string) {
  const runtimeEnv = env as typeof env & { APP_ORIGIN?: string };
  const rawOrigin =
    runtimeEnv.APP_ORIGIN ??
    process.env.APP_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!rawOrigin) return eventCanonicalPath(slug);

  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
      return eventCanonicalPath(slug);
    }
    return new URL(eventCanonicalPath(slug), origin).toString();
  } catch {
    return eventCanonicalPath(slug);
  }
}

export function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
