ALTER TABLE `rooms` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `phase` text DEFAULT 'lobby' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `player_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `player_limit` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `host_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `host_last_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `rooms_public_listing_idx` ON `rooms` (`visibility`,`phase`,`expires_at`,`updated_at`);