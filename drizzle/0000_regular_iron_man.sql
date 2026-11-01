CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`element_id` text NOT NULL,
	`state` text NOT NULL,
	`value` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	`notified_at` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_events_state_idx` ON `alert_events` (`state`,`started_at`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`element_id` text,
	`element_kind` text,
	`metric_key` text NOT NULL,
	`operator` text NOT NULL,
	`threshold` integer NOT NULL,
	`for_seconds` integer DEFAULT 120 NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`auto_for_element_id` text,
	`layout` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auto_for_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `docker_endpoints` (
	`element_id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 2375 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_check_at` integer,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `element_access` (
	`user_id` text NOT NULL,
	`element_id` text NOT NULL,
	`granted_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `element_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `element_metrics` (
	`element_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`widget` text,
	`thresholds` text,
	PRIMARY KEY(`element_id`, `metric_key`),
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `elements` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`monitored` integer DEFAULT false NOT NULL,
	`is_new` integer DEFAULT true NOT NULL,
	`missing` integer DEFAULT false NOT NULL,
	`info` text DEFAULT '{}' NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elements_identity_uq` ON `elements` (`server_id`,`kind`,`external_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `elements_parent_idx` ON `elements` (`parent_id`);--> statement-breakpoint
CREATE INDEX `elements_server_idx` ON `elements` (`server_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_endpoint_uq` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`token_id` text NOT NULL,
	`token_secret_enc` text NOT NULL,
	`verify_tls` integer DEFAULT false NOT NULL,
	`tls_fingerprint` text,
	`poll_interval_sec` integer DEFAULT 30 NOT NULL,
	`pve_version` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_seen_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_exp_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`email` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'monitor' NOT NULL,
	`totp_secret_enc` text,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);