import type {
  Signal,
  SignalCategory,
  SignalSource,
  SignalStatus,
} from "@/shared/signals";

type EventRow = {
  id: string;
  slug: string;
  title_zh: string;
  title_original: string;
  summary_zh: string;
  why_it_matters: string;
  status: string;
  confidence: number;
  trend_score: number;
  ranking_score: number;
  region: string;
  published_at: number;
  topic_text: string;
};

type RadarCursor = {
  version: 1;
  rankingScore: number;
  publishedAt: number;
  id: string;
};

export type LiveSignalPage = {
  signals: Signal[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class InvalidRadarCursorError extends Error {
  constructor() {
    super("雷达游标无效");
    this.name = "InvalidRadarCursorError";
  }
}

type EvidenceRow = {
  event_id: string;
  source_name: string;
  canonical_url: string;
  title_original: string;
  summary_original: string | null;
  language: string;
  authority: number;
  official: number;
};

function signalStatus(value: string): SignalStatus {
  return value === "已确认" || value === "多源确认" || value === "有冲突"
    ? value
    : "待核实";
}

function categoryFor(text: string): SignalCategory {
  const value = text.toLowerCase();
  if (/政策|监管|合规|act|regulat/.test(value)) return "政策监管";
  if (/安全|风险|safety|security|nist/.test(value)) return "安全治理";
  if (/研究|论文|science|arxiv|research/.test(value)) return "研究突破";
  if (/开发|coding|copilot|agent|sdk|tool|mcp/.test(value)) return "开发工具";
  if (/开源|开放权重|open.?source|github|hugging/.test(value)) return "开源生态";
  if (/发布|模型|model|gpt|llama|qwen|claude/.test(value)) return "模型发布";
  return "公司动态";
}

function sourceFor(row: EvidenceRow): SignalSource {
  return {
    name: row.source_name,
    type: row.official === 1 ? "官方来源" : "研究来源",
    url: row.canonical_url,
    authority: row.official === 1 ? "一手" : "研究",
  };
}

function base64UrlEncode(value: string) {
  let binary = "";
  for (const byte of textEncoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new InvalidRadarCursorError();
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return textDecoder.decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new InvalidRadarCursorError();
  }
}

function encodeCursor(event: EventRow) {
  return base64UrlEncode(
    JSON.stringify({
      version: 1,
      rankingScore: event.ranking_score,
      publishedAt: event.published_at,
      id: event.id,
    } satisfies RadarCursor),
  );
}

function decodeCursor(value: string | null | undefined): RadarCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<RadarCursor>;
    if (
      parsed.version !== 1 ||
      !Number.isFinite(parsed.rankingScore) ||
      !Number.isFinite(parsed.publishedAt) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 160
    ) {
      throw new InvalidRadarCursorError();
    }
    return parsed as RadarCursor;
  } catch (error) {
    if (error instanceof InvalidRadarCursorError) throw error;
    throw new InvalidRadarCursorError();
  }
}

const eligibleEventSql = `e.quarantined = 0
  AND EXISTS (
    SELECT 1 FROM event_items evidence
    JOIN source_items evidence_item ON evidence_item.id = evidence.source_item_id
    WHERE evidence.event_id = e.id
      AND evidence_item.processing_status = 'enriched'
  )`;

async function loadEvidence(db: D1Database, events: EventRow[]) {
  if (events.length === 0) return [];
  const placeholders = events.map(() => "?").join(",");
  const evidenceResult = await db
    .prepare(
      `SELECT ei.event_id, s.name AS source_name, si.canonical_url,
              si.title_original, si.summary_original, si.language, s.authority, s.official
       FROM event_items ei
       JOIN source_items si ON si.id = ei.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE ei.event_id IN (${placeholders})
         AND si.processing_status = 'enriched'
       ORDER BY s.authority DESC, si.published_at ASC`,
    )
    .bind(...events.map((event) => event.id))
    .all<EvidenceRow>();
  return evidenceResult.results ?? [];
}

function mapSignals(events: EventRow[], evidence: EvidenceRow[]) {
  const evidenceByEvent = new Map<string, EvidenceRow[]>();
  for (const row of evidence) {
    const rows = evidenceByEvent.get(row.event_id) ?? [];
    rows.push(row);
    evidenceByEvent.set(row.event_id, rows);
  }

  return events.flatMap((event) => {
    const eventEvidence = evidenceByEvent.get(event.id) ?? [];
    if (eventEvidence.length === 0) return [];
    const primary = eventEvidence[0];
    const tags = Array.from(
      new Set(
        event.topic_text
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).slice(0, 8);
    const date = new Date(event.published_at);
    const context = `${event.title_zh} ${event.summary_zh} ${event.topic_text}`;
    const signal: Signal = {
      id: event.id,
      slug: event.slug,
      category: categoryFor(context),
      title: event.title_zh,
      summary: event.summary_zh,
      whyItMatters: event.why_it_matters,
      newFacts: eventEvidence
        .slice(0, 3)
        .map((source) => `${source.source_name}：${source.title_original}`),
      recommendationReason: "已通过来源质量门，并按趋势、权威度与多源证据排序",
      sources: eventEvidence.map(sourceFor),
      publishedAt: date.toISOString(),
      displayTime: `真实采集 · ${date.toISOString().slice(0, 10)}`,
      trend: event.trend_score,
      momentum: "趋势上升",
      confidence: event.confidence,
      status: signalStatus(event.status),
      region: event.region,
      tags,
      evidenceCount: eventEvidence.length,
      entities: tags,
      readMinutes: Math.max(1, Math.ceil(event.summary_zh.length / 260)),
      dataMode: "live",
      originalTitle: event.title_original || primary.title_original,
      originalSummary: primary.summary_original ?? undefined,
      originalLanguage: primary.language,
      translationState: primary.language.toLowerCase().startsWith("zh")
        ? "original_zh"
        : "translated",
    };
    return [signal];
  });
}

export async function loadLiveSignalPage(
  db: D1Database,
  options: { cursor?: string | null; pageSize?: number } = {},
): Promise<LiveSignalPage> {
  const requestedPageSize = Number.isFinite(options.pageSize)
    ? Math.floor(options.pageSize as number)
    : DEFAULT_PAGE_SIZE;
  const pageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, requestedPageSize),
  );
  const cursor = decodeCursor(options.cursor);
  const cursorPredicate = cursor
    ? `AND (
         e.trend_score < ?
         OR (e.trend_score = ? AND e.published_at < ?)
         OR (e.trend_score = ? AND e.published_at = ? AND e.id < ?)
       )`
    : "";
  const bindings: Array<string | number> = [Date.now()];
  if (cursor) {
    bindings.push(
      cursor.rankingScore,
      cursor.rankingScore,
      cursor.publishedAt,
      cursor.rankingScore,
      cursor.publishedAt,
      cursor.id,
    );
  }
  bindings.push(pageSize + 1);

  const [eventResult, totalRow] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.slug, e.title_zh, e.title_original, e.summary_zh, e.why_it_matters,
              e.status, e.confidence,
              e.trend_score AS ranking_score,
              MAX(0, e.trend_score - CAST(MAX(0, ? - e.published_at) / 86400000 AS INTEGER) * 3) AS trend_score,
              e.region, e.published_at,
              COALESCE(GROUP_CONCAT(t.name, ' '), '') AS topic_text
       FROM events e
       LEFT JOIN event_topics et ON et.event_id = e.id
       LEFT JOIN topics t ON t.id = et.topic_id
       WHERE ${eligibleEventSql}
       ${cursorPredicate}
       GROUP BY e.id
       ORDER BY e.trend_score DESC, e.published_at DESC, e.id DESC
       LIMIT ?`,
      )
      .bind(...bindings)
      .all<EventRow>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM events e WHERE ${eligibleEventSql}`)
      .first<{ count: number }>(),
  ]);

  const rows = eventResult.results ?? [];
  const hasMore = rows.length > pageSize;
  const events = rows.slice(0, pageSize);
  const evidence = await loadEvidence(db, events);
  return {
    signals: mapSignals(events, evidence),
    nextCursor: hasMore && events.length > 0 ? encodeCursor(events[events.length - 1]) : null,
    hasMore,
    total: Number(totalRow?.count ?? 0),
  };
}

export async function loadLiveSignal(db: D1Database, eventId: string): Promise<Signal | null> {
  const event = await db
    .prepare(
      `SELECT e.id, e.slug, e.title_zh, e.title_original, e.summary_zh, e.why_it_matters,
              e.status, e.confidence, e.trend_score AS ranking_score,
              MAX(0, e.trend_score - CAST(MAX(0, ? - e.published_at) / 86400000 AS INTEGER) * 3) AS trend_score,
              e.region, e.published_at,
              COALESCE(GROUP_CONCAT(t.name, ' '), '') AS topic_text
       FROM events e
       LEFT JOIN event_topics et ON et.event_id = e.id
       LEFT JOIN topics t ON t.id = et.topic_id
       WHERE e.id = ? AND ${eligibleEventSql}
       GROUP BY e.id
       LIMIT 1`,
    )
    .bind(Date.now(), eventId)
    .first<EventRow>();
  if (!event) return null;
  const evidence = await loadEvidence(db, [event]);
  return mapSignals([event], evidence)[0] ?? null;
}

export async function loadLiveSignals(db: D1Database, limit = 50): Promise<Signal[]> {
  const target = Math.max(1, Math.floor(limit));
  const signals: Signal[] = [];
  let cursor: string | null = null;
  do {
    const page = await loadLiveSignalPage(db, {
      cursor,
      pageSize: Math.min(MAX_PAGE_SIZE, target - signals.length),
    });
    signals.push(...page.signals);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  } while (signals.length < target && cursor);
  return signals.slice(0, target);
}
