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
  region: string;
  published_at: number;
  topic_text: string;
};

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

export async function loadLiveSignals(db: D1Database, limit = 100): Promise<Signal[]> {
  const bounded = Math.max(1, Math.min(limit, 100));
  const eventResult = await db
    .prepare(
      `SELECT e.id, e.slug, e.title_zh, e.title_original, e.summary_zh, e.why_it_matters,
              e.status, e.confidence,
              MAX(0, e.trend_score - CAST(MAX(0, ? - e.published_at) / 86400000 AS INTEGER) * 3) AS trend_score,
              e.region, e.published_at,
              COALESCE(GROUP_CONCAT(t.name, ' '), '') AS topic_text
       FROM events e
       LEFT JOIN event_topics et ON et.event_id = e.id
       LEFT JOIN topics t ON t.id = et.topic_id
       WHERE e.quarantined = 0
         AND EXISTS (
           SELECT 1 FROM event_items evidence
           JOIN source_items evidence_item ON evidence_item.id = evidence.source_item_id
           WHERE evidence.event_id = e.id
             AND evidence_item.processing_status = 'enriched'
         )
       GROUP BY e.id
       ORDER BY e.trend_score DESC, e.published_at DESC
       LIMIT ?`,
    )
    .bind(Date.now(), bounded)
    .all<EventRow>();
  const events = eventResult.results ?? [];
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
  const evidence = evidenceResult.results ?? [];

  return events.flatMap((event) => {
    const eventEvidence = evidence.filter((row) => row.event_id === event.id);
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
