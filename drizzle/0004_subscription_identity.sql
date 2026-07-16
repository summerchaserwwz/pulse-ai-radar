CREATE UNIQUE INDEX `subscriptions_email_uq` ON `subscriptions` (`email`);--> statement-breakpoint
CREATE TABLE `subscription_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `subscription_rate_limits_updated_idx` ON `subscription_rate_limits` (`updated_at`);
