-- La regla genérica de memoria incluía las VMs (Proxmox cuenta la caché del invitado). Se separa en nodo y LXC conservando los valores editados.
INSERT INTO alert_rules (id, name, element_id, element_kind, metric_key, operator, threshold, for_seconds, severity, enabled, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
       name || ' (nodo)', NULL, 'node', metric_key, operator, threshold, for_seconds, severity, enabled, created_at
FROM alert_rules WHERE metric_key = 'mem.usage' AND element_id IS NULL AND element_kind IS NULL;
--> statement-breakpoint
UPDATE alert_rules SET name = name || ' (LXC)', element_kind = 'lxc'
WHERE metric_key = 'mem.usage' AND element_id IS NULL AND element_kind IS NULL;
