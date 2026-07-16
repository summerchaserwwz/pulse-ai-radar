ALTER TABLE `events` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_fingerprint_uq` ON `events` (`fingerprint`);