CREATE TABLE `mail_events` (
	`id` text PRIMARY KEY NOT NULL,
	`element_id` text NOT NULL,
	`message_id` text NOT NULL,
	`ok` integer NOT NULL,
	`at` integer NOT NULL,
	`detail` text,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_events_message_id_unique` ON `mail_events` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_events_el_idx` ON `mail_events` (`element_id`,`at`);--> statement-breakpoint
ALTER TABLE `backup_status` ADD `max_hours_override` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `kind` text DEFAULT 'proxmox' NOT NULL;