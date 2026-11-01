ALTER TABLE `docker_endpoints` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `docker_endpoints` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Reglas por defecto nuevas, solo en instalaciones existentes (en las nuevas las crea el arranque)
INSERT INTO alert_rules (id, name, element_id, element_kind, metric_key, operator, threshold, for_seconds, severity, enabled, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       'Docker sin respuesta', NULL, NULL, 'docker.online', '==', 0, 180, 'warning', 1, unixepoch()
WHERE EXISTS (SELECT 1 FROM alert_rules) AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE metric_key = 'docker.online');
--> statement-breakpoint
INSERT INTO alert_rules (id, name, element_id, element_kind, metric_key, operator, threshold, for_seconds, severity, enabled, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       'Contenedor en mal estado', NULL, NULL, 'health', '==', 0, 120, 'warning', 1, unixepoch()
WHERE EXISTS (SELECT 1 FROM alert_rules) AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE metric_key = 'health');
