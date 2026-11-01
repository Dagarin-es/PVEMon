CREATE TABLE `backup_status` (
	`element_id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`state` text NOT NULL,
	`last_ok_at` integer,
	`last_ok_size` integer,
	`last_ok_storage` text,
	`last_attempt_at` integer,
	`last_attempt_ok` integer,
	`message` text,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `servers` ADD `backup_max_hours` integer DEFAULT 192 NOT NULL;
--> statement-breakpoint
-- Regla por defecto nueva, solo en instalaciones existentes (en las nuevas la crea el arranque)
INSERT INTO alert_rules (id, name, element_id, element_kind, metric_key, operator, threshold, for_seconds, severity, enabled, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       'Copia de seguridad con problema', NULL, NULL, 'backup.problem', '==', 1, 60, 'critical', 1, unixepoch()
WHERE EXISTS (SELECT 1 FROM alert_rules) AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE metric_key = 'backup.problem');
