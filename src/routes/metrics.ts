import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { allowedElementIds } from '../auth/access.js';
import { audit } from '../auth/audit.js';
import { requireAdmin, requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';
import { metricByKey, metricsFor } from '../metrics/catalog.js';

const { elements, elementMetrics } = schema;

const vmMem = (kind: string, key: string) => kind === 'vm' && (key === 'mem.usage' || key === 'mem.used');
const VM_MEM_NOTE = 'Lo calcula Proxmox desde fuera de la VM y puede incluir la caché del sistema invitado, así que suele salir más alto que el uso real que ve el propio sistema.';

const RANGES = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 } as const;

export const metricRoutes: FastifyPluginAsync = async (app) => {
  const canView = (user: { id: string; role: string }, el: typeof elements.$inferSelect) => {
    if (user.role === 'admin') return true;
    const allowed = allowedElementIds(user);
    return !!allowed && allowed.has(el.id) && el.monitored && !el.missing;
  };

  /** Métricas disponibles de un elemento, con su último valor y cómo se muestran. */
  app.get<{ Params: { id: string } }>('/elements/:id/metrics', { preHandler: requireAuth }, async (req, reply) => {
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    // Misma respuesta si no existe o no tiene permiso: no se revela qué hay
    if (!el || !canView(req.user!, el)) return reply.code(404).send({ error: 'Elemento no encontrado' });

    const overrides = new Map(db.select().from(elementMetrics).where(eq(elementMetrics.elementId, el.id)).all().map((o) => [o.metricKey, o]));
    const hasDocker = el.kind !== 'vm' && el.kind !== 'lxc' ? false
      : !!db.select().from(schema.dockerEndpoints).where(eq(schema.dockerEndpoints.elementId, el.id)).get()?.enabled;
    const hasBackup = ['ok', 'error', 'stale'].includes(db.select().from(schema.backupStatus).where(eq(schema.backupStatus.elementId, el.id)).get()?.state ?? '');
    const defs = metricsFor(el.kind).filter((m) => m.source !== 'host' && (m.key !== 'docker.online' || hasDocker) && (m.source !== 'backup' || hasBackup)); // 'host' (sensores/agente) llega en otra fase
    const latest = app.metrics.latest(el.id, defs.map((d) => d.key));
    return {
      metrics: defs.map((d) => {
        const o = overrides.get(d.key);
        return {
          key: d.key, label: d.label, unit: d.unit,
          enabled: o?.enabled ?? d.defaultOn,
          widget: o?.widget ?? d.widget,
          thresholds: o?.thresholds ?? (vmMem(el.kind, d.key) ? null : d.thresholds ?? null),
          note: vmMem(el.kind, d.key) ? VM_MEM_NOTE : undefined,
          latest: latest[d.key] ?? null,
        };
      }),
    };
  });

  /** Serie temporal de una métrica. */
  const rangeQuery = z.object({ range: z.enum(['1h', '6h', '24h', '7d', '30d', '90d']).default('24h') });
  app.get<{ Params: { id: string; key: string } }>('/elements/:id/metrics/:key', { preHandler: requireAuth }, async (req, reply) => {
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'range debe ser 1h, 6h, 24h, 7d, 30d o 90d' });
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    const def = metricByKey(req.params.key);
    if (!el || !def || !def.appliesTo.includes(el.kind) || !canView(req.user!, el)) {
      return reply.code(404).send({ error: 'Métrica no encontrada' });
    }
    const to = Math.floor(Date.now() / 1000);
    const from = to - RANGES[q.data.range];
    return { key: def.key, unit: def.unit, from, to, points: app.metrics.query({ elementId: el.id, metricKey: def.key, from, to, maxPoints: 300 }) };
  });

  /** Qué métricas se muestran y cómo (solo administradores). */
  const configBody = z.object({
    enabled: z.boolean().optional(),
    widget: z.enum(['gauge', 'line', 'chip', 'number']).nullable().optional(),
    thresholds: z.object({ warn: z.number().optional(), crit: z.number().optional() }).nullable().optional(),
  });
  app.put<{ Params: { id: string; key: string } }>('/elements/:id/metrics/:key', { preHandler: requireAdmin }, async (req, reply) => {
    const body = configBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const el = db.select().from(elements).where(eq(elements.id, req.params.id)).get();
    const def = metricByKey(req.params.key);
    if (!el || !def || !def.appliesTo.includes(el.kind)) return reply.code(404).send({ error: 'Métrica no encontrada' });

    const prev = db.select().from(elementMetrics)
      .where(and(eq(elementMetrics.elementId, el.id), eq(elementMetrics.metricKey, def.key))).get();
    const values = {
      elementId: el.id, metricKey: def.key,
      enabled: body.data.enabled ?? prev?.enabled ?? def.defaultOn,
      widget: body.data.widget === undefined ? prev?.widget ?? null : body.data.widget,
      thresholds: body.data.thresholds === undefined ? prev?.thresholds ?? null : body.data.thresholds,
    };
    db.insert(elementMetrics).values(values)
      .onConflictDoUpdate({ target: [elementMetrics.elementId, elementMetrics.metricKey], set: values }).run();
    audit(req.user!.id, 'metric.config', `${el.name}/${def.key}`, body.data);
    return { ok: true };
  });
};
