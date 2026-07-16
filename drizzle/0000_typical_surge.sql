CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subscription_id` text,
	`channel` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_user_date_channel_uq` ON `deliveries` (`user_id`,`local_date`,`channel`);--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `deliveries` (`status`);--> statement-breakpoint
CREATE TABLE `event_items` (
	`event_id` text NOT NULL,
	`source_item_id` text NOT NULL,
	`support_kind` text DEFAULT 'supports' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `source_item_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_item_id`) REFERENCES `source_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_items_source_item_uq` ON `event_items` (`source_item_id`);--> statement-breakpoint
CREATE TABLE `event_topics` (
	`event_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`relevance` integer DEFAULT 50 NOT NULL,
	PRIMARY KEY(`event_id`, `topic_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_zh` text NOT NULL,
	`title_original` text NOT NULL,
	`summary_zh` text NOT NULL,
	`why_it_matters` text NOT NULL,
	`status` text NOT NULL,
	`confidence` integer NOT NULL,
	`trend_score` integer NOT NULL,
	`region` text NOT NULL,
	`quarantined` integer DEFAULT false NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_uq` ON `events` (`slug`);--> statement-breakpoint
CREATE INDEX `events_rank_idx` ON `events` (`quarantined`,`trend_score`,`published_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`signal_id` text NOT NULL,
	`action` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_user_signal_action_uq` ON `feedback` (`user_id`,`signal_id`,`action`);--> statement-breakpoint
CREATE INDEX `feedback_user_active_idx` ON `feedback` (`user_id`,`active`);--> statement-breakpoint
CREATE TABLE `interests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'topic' NOT NULL,
	`value` text NOT NULL,
	`weight` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interests_user_kind_value_uq` ON `interests` (`user_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `interests_user_idx` ON `interests` (`user_id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`source_id` text,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_stage_status_idx` ON `pipeline_runs` (`stage`,`status`);--> statement-breakpoint
CREATE TABLE `source_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title_original` text NOT NULL,
	`summary_original` text,
	`language` text NOT NULL,
	`content_hash` text NOT NULL,
	`raw_object_key` text,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_items_source_external_uq` ON `source_items` (`source_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_items_canonical_url_uq` ON `source_items` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `source_items_status_idx` ON `source_items` (`processing_status`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`feed_url` text NOT NULL,
	`homepage_url` text NOT NULL,
	`region` text NOT NULL,
	`language` text NOT NULL,
	`authority` integer DEFAULT 50 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_feed_url_uq` ON `sources` (`feed_url`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`digest_hour` integer DEFAULT 8 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rss_token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_uq` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_rss_token_hash_uq` ON `subscriptions` (`rss_token_hash`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_kind_name_uq` ON `topics` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`auto_translate` integer DEFAULT true NOT NULL,
	`verified_only` integer DEFAULT false NOT NULL,
	`dense_mode` integer DEFAULT true NOT NULL,
	`instant_alerts` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);