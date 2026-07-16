ALTER TABLE `source_items` ADD `enrichment_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_items` ADD `next_retry_at` integer;--> statement-breakpoint
ALTER TABLE `source_items` ADD `last_error_code` text;--> statement-breakpoint
CREATE INDEX `source_items_retry_idx` ON `source_items` (`processing_status`,`next_retry_at`);
