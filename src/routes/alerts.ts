import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { allowedElementIds } from '../auth/access.js';
import { audit } from '../auth/audit.js';
import { requireAdmin, requireAuth } from '../auth/guard.js';
import { describeValue, pathOf } from '../alerts/engine.js';
import { db, schema } from '../db/index.js';

const { alertRules, alertEvents, elements } = schema;

const ruleBody = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().int().min(0).max(1_000_000_000).optional(),
  forSeconds: z.number().int().min(0).max(86_400).optional(),
  severity: z.enum(['warning', 'critical']).optional(),
});

export const alertRoutes: FastifyPluginAsync = async (app) => {
  /** Alertas abiertas y las últimas resueltas. Un Monitor solo ve las de lo que tiene asignado. */
  app.get('/alerts', { preHandler: requireAuth }, async (req) => {
    const allowed = allowedElementIds(req.user!);
    const els = new Map(db.select().from(elements).all().map((e) => [e.id, e]));
    const rules = new Map(db.select().from(alertRules).all().map((r) => [r.id, r]));
    const visible = (e: { elementId: string }) => allowed === null || allowed.has(e.elementId);
    const shape = (e: typeof alertEvents.$inferSelect) => {
      const el = els.get(e.elementId);
      const rule = rules.get(e.ruleId);
      return {
        id: e.id, state: e.state, severity: rule?.severity ?? 'warning', ruleName: rule?.name ?? '',
        elementId: e.elementId, elementName: el?.alias ?? el?.name ?? '?', kind: el?.kind ?? '',
        path: el ? pathOf(el, els) : '', text: rule ? describeValue(rule, Number(e.value), e.elementId) : '',
        startedAt: e.startedAt, resolvedAt: e.resolvedAt, snoozedUntil: e.snoozedUntil,
      };
    };
    const active = db.select().from(alertEvents).where(eq(alertEvents.state, 'firing')).orderBy(desc(alertEvents.startedAt)).all();
    const recent = db.select().from(alertEvents).where(eq(alertEvents.state, 'resolved')).orderBy(desc(alertEvents.resolvedAt)).limit(100).all();
    const now = Math.floor(Date.now() / 1000);
    const isSnoozed = (e: typeof alertEvents.$inferSelect) => (e.snoozedUntil ?? 0) > now;
    return { active: active.filter(visible).filter((e) => !isSnoozed(e)).map(shape), snoozed: active.filter(visible).filter(isSnoozed).map(shape), recent: recent.filter(visible).slice(0, 50).map(shape) };
  });

  /** Pospone una alerta abierta (minutos; 0 = quitar el aplazamiento). Mientras dura no cuenta como activa ni avisa. */
  app.post<{ Params: { id: string } }>('/alerts/:id/snooze', { preHandler: requireAdmin }, async (req, reply) => {
    const b = z.object({ minutes: z.number().int().min(0).max(60 * 24 * 30) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const ev = db.select().from(alertEvents).where(eq(alertEvents.id, req.params.id)).get();
    if (!ev || ev.state !== 'firing') return reply.code(404).send({ error: 'Esa alerta ya no está activa' });
    const until = b.data.minutes > 0 ? Math.floor(Date.now() / 1000) + b.data.minutes * 60 : null;
    // también las anteriores de la misma regla y elemento, para que no «herede» un aplazamiento viejo al reabrirse
    db.update(alertEvents).set({ snoozedUntil: until }).where(and(eq(alertEvents.ruleId, ev.ruleId), eq(alertEvents.elementId, ev.elementId))).run();
    audit(req.user!.id, until ? 'alert.snooze' : 'alert.unsnooze', ev.elementId, { minutes: b.data.minutes });
    return { ok: true, snoozedUntil: until };
  });

  app.get('/alert-rules', { preHandler: requireAdmin }, async () => ({
    rules: db.select().from(alertRules).all().map((r) => ({
      id: r.id, name: r.name, metricKey: r.metricKey, operator: r.operator, threshold: r.threshold,
      forSeconds: r.forSeconds, severity: r.severity, enabled: r.enabled,
    })),
  }));

  app.put<{ Params: { id: string } }>('/alert-rules/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const b = ruleBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const rule = db.select().from(alertRules).where(eq(alertRules.id, req.params.id)).get();
    if (!rule) return reply.code(404).send({ error: 'Regla no encontrada' });
    if (Object.keys(b.data).length > 0) db.update(alertRules).set(b.data).where(eq(alertRules.id, rule.id)).run();
    audit(req.user!.id, 'alert-rule.update', rule.name, b.data);
    return { ok: true };
  });
};
