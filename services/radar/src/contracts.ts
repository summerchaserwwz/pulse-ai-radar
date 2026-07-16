export type SourceKind = "rss" | "atom" | "api";

export type SourceDefinition = {
  id: string;
  name: string;
  kind: SourceKind;
  feedUrl: string;
  homepageUrl: string;
  region: string;
  language: string;
  authority: number;
  official: boolean;
  snapshotAllowed: boolean;
  includeTerms: string[];
  maxResponseBytes?: number;
};

export type FeedItem = {
  externalId: string;
  canonicalUrl: string;
  title: string;
  summary: string;
  publishedAt: number;
};

export type StoredSourceItem = FeedItem & {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceHomepage: string;
  sourceAuthority: number;
  sourceOfficial: boolean;
  language: string;
  contentHash: string;
};

export type EnrichedItem = {
  titleZh: string;
  summaryZh: string;
  whyItMatters: string;
  entities: string[];
  topics: string[];
  impact: "high" | "medium" | "low";
  translationState: "translated" | "original_zh" | "pending";
  promptInjectionDetected: boolean;
};

export type RadarEventRow = {
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
  topic_text: string;
  published_at: number;
  updated_at: number;
};

export type SourceFetchMessage = { kind: "source-fetch"; sourceId: string };
export type ItemEnrichMessage = { kind: "item-enrich"; sourceItemId: string };
export type EventClusterMessage = {
  kind: "event-cluster";
  sourceItemId: string;
  enriched: EnrichedItem;
};
export type DeliveryMessage = {
  kind: "delivery";
  deliveryKind: "confirmation" | "daily";
  subscriptionId: string;
  localDate: string;
};

export type RadarQueueMessage =
  | SourceFetchMessage
  | ItemEnrichMessage
  | EventClusterMessage
  | DeliveryMessage;

export type RadarEnv = {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  EVENT_INDEX: VectorizeIndex;
  SOURCE_FETCH_QUEUE: Queue<SourceFetchMessage>;
  ITEM_ENRICH_QUEUE: Queue<ItemEnrichMessage>;
  EVENT_CLUSTER_QUEUE: Queue<EventClusterMessage>;
  DELIVERY_QUEUE: Queue<DeliveryMessage>;
  AI?: Ai;
  OPENAI_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  TEST_RECIPIENT?: string;
  APP_ORIGIN?: string;
  AUTH_SIGNING_KEY?: string;
  CRON_SECRET?: string;
};
