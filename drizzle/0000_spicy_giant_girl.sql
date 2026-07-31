CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`content_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_client_idx` ON `activities` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`content_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'image' NOT NULL,
	`mime` text,
	`size` integer,
	`storage_key` text,
	`url` text,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_content_idx` ON `assets` (`content_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`initials` text,
	`brand_primary` text DEFAULT '#e96f34' NOT NULL,
	`brand_accent` text DEFAULT '#5c75d8' NOT NULL,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`monthly_goal` integer DEFAULT 30 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_slug_idx` ON `clients` (`slug`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`content_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_content_idx` ON `comments` (`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`format` text DEFAULT 'Vídeo' NOT NULL,
	`publish_date` text NOT NULL,
	`publish_time` text,
	`stage_id` text NOT NULL,
	`pillar_id` text,
	`funnel_id` text,
	`platforms` text DEFAULT '[]' NOT NULL,
	`cta` text,
	`hook` text,
	`script` text,
	`notes` text,
	`assignee_id` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`approval` text DEFAULT 'none' NOT NULL,
	`published_at` integer,
	`permalink` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contents_client_idx` ON `contents` (`client_id`,`archived`);--> statement-breakpoint
CREATE INDEX `contents_date_idx` ON `contents` (`client_id`,`publish_date`);--> statement-breakpoint
CREATE INDEX `contents_stage_idx` ON `contents` (`client_id`,`stage_id`,`position`);--> statement-breakpoint
CREATE TABLE `funnels` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funnels_client_idx` ON `funnels` (`client_id`,`position`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_pair_idx` ON `memberships` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`content_id` text NOT NULL,
	`platform` text DEFAULT 'Instagram' NOT NULL,
	`captured_at` integer NOT NULL,
	`reach` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`saves` integer DEFAULT 0 NOT NULL,
	`shares` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`leads` integer DEFAULT 0 NOT NULL,
	`revenue` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_content_idx` ON `metrics` (`content_id`);--> statement-breakpoint
CREATE INDEX `metrics_client_idx` ON `metrics` (`client_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `pillars` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'violet' NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pillars_client_idx` ON `pillars` (`client_id`,`position`);--> statement-breakpoint
CREATE TABLE `stages` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'production' NOT NULL,
	`wip_limit` integer
);
--> statement-breakpoint
CREATE INDEX `stages_client_idx` ON `stages` (`client_id`,`position`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`name` text NOT NULL,
	`format` text DEFAULT 'Vídeo' NOT NULL,
	`hook` text,
	`script` text,
	`cta` text,
	`platforms` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`accent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_external_idx` ON `users` (`external_id`);