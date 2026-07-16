import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    feedUrl: text("feed_url").notNull(),
    homepageUrl: text("homepage_url").notNull(),
    region: text("region").notNull(),
    language: text("language").notNull(),
    authority: integer("authority").notNull().default(50),
    official: integer("official", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFetchedAt: integer("last_fetched_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("sources_feed_url_uq").on(table.feedUrl)],
);

export const sourceItems = sqliteTable(
  "source_items",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    titleOriginal: text("title_original").notNull(),
    summaryOriginal: text("summary_original"),
    language: text("language").notNull(),
    contentHash: text("content_hash").notNull(),
    rawObjectKey: text("raw_object_key"),
    processingStatus: text("processing_status").notNull().default("pending"),
    enrichmentAttempts: integer("enrichment_attempts").notNull().default(0),
    nextRetryAt: integer("next_retry_at"),
    lastErrorCode: text("last_error_code"),
    publishedAt: integer("published_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("source_items_source_external_uq").on(
      table.sourceId,
      table.externalId,
    ),
    uniqueIndex("source_items_canonical_url_uq").on(table.canonicalUrl),
    index("source_items_status_idx").on(table.processingStatus),
    index("source_items_retry_idx").on(
      table.processingStatus,
      table.nextRetryAt,
    ),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    fingerprint: text("fingerprint"),
    titleZh: text("title_zh").notNull(),
    titleOriginal: text("title_original").notNull(),
    summaryZh: text("summary_zh").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    status: text("status").notNull(),
    confidence: integer("confidence").notNull(),
    trendScore: integer("trend_score").notNull(),
    region: text("region").notNull(),
    quarantined: integer("quarantined", { mode: "boolean" })
      .notNull()
      .default(false),
    publishedAt: integer("published_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_slug_uq").on(table.slug),
    uniqueIndex("events_fingerprint_uq").on(table.fingerprint),
    index("events_rank_idx").on(
      table.quarantined,
      table.trendScore,
      table.publishedAt,
    ),
  ],
);

export const eventItems = sqliteTable(
  "event_items",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    supportKind: text("support_kind").notNull().default("supports"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.sourceItemId] }),
    uniqueIndex("event_items_source_item_uq").on(table.sourceItemId),
  ],
);

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("topics_kind_name_uq").on(table.kind, table.name)],
);

export const eventTopics = sqliteTable(
  "event_topics",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    relevance: integer("relevance").notNull().default(50),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.topicId] })],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    autoTranslate: integer("auto_translate", { mode: "boolean" })
      .notNull()
      .default(true),
    verifiedOnly: integer("verified_only", { mode: "boolean" })
      .notNull()
      .default(false),
    denseMode: integer("dense_mode", { mode: "boolean" })
      .notNull()
      .default(true),
    instantAlerts: integer("instant_alerts", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_uq").on(table.email)],
);

export const interests = sqliteTable(
  "interests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("topic"),
    value: text("value").notNull(),
    weight: integer("weight").notNull().default(100),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("interests_user_kind_value_uq").on(
      table.userId,
      table.kind,
      table.value,
    ),
    index("interests_user_idx").on(table.userId),
  ],
);

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalId: text("signal_id").notNull(),
    action: text("action").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("feedback_user_signal_action_uq").on(
      table.userId,
      table.signalId,
      table.action,
    ),
    index("feedback_user_active_idx").on(table.userId, table.active),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    digestHour: integer("digest_hour").notNull().default(8),
    status: text("status").notNull().default("pending"),
    rssTokenHash: text("rss_token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_uq").on(table.userId),
    uniqueIndex("subscriptions_email_uq").on(table.email),
    uniqueIndex("subscriptions_rss_token_hash_uq").on(table.rssTokenHash),
    index("subscriptions_status_idx").on(table.status),
  ],
);

export const subscriptionRateLimits = sqliteTable(
  "subscription_rate_limits",
  {
    key: text("key").primaryKey(),
    scope: text("scope").notNull(),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("subscription_rate_limits_updated_idx").on(table.updatedAt)],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    channel: text("channel").notNull(),
    localDate: text("local_date").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id"),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("deliveries_user_date_channel_uq").on(
      table.userId,
      table.localDate,
      table.channel,
    ),
    index("deliveries_status_idx").on(table.status),
  ],
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    sourceId: text("source_id"),
    processedCount: integer("processed_count").notNull().default(0),
    errorCode: text("error_code"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [index("pipeline_runs_stage_status_idx").on(table.stage, table.status)],
);
