CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`kind` text DEFAULT 'telegram' NOT NULL,
	`target` text NOT NULL,
	`label` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `channels_client_idx` ON `channels` (`client_id`,`active`);--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`content_id` text NOT NULL,
	`mode` text DEFAULT 'notify' NOT NULL,
	`run_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`idempotency_key` text NOT NULL,
	`sent_at` integer,
	`done_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publish_jobs_key_idx` ON `publish_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `publish_jobs_due_idx` ON `publish_jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `publish_jobs_client_idx` ON `publish_jobs` (`client_id`,`content_id`);