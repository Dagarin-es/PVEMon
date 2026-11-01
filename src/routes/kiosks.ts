import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { allowedElementIds } from '../auth/access.js';
import { requireAuth } from '../auth/guard.js';
import { db, schema } from '../db/index.js';

const { kiosks, kioskDevices, kioskGroups, kioskDeviceGroups, kioskMain, elements } = schema;

const pct = z.number().min(0).max(100);
const tile = z.object({
  id: z.string().min(1).max(40),
  elementId: z.string().max(80),
  type: z.enum(['systems', 'backups', 'text']).optional(),
  text: z.string().max(600).optional(), fs: z.number().min(1).max(6).optional(),
  al: z.enum(['left', 'center', 'right']).optional(), nb: z.boolean().optional(), bg: z.boolean().optional(),
  x: pct, y: pct, w: z.number().min(4).max(100), h: z.number().min(4).max(100),
  cpu: z.boolean(), mem: z.boolean(), disk: z.boolean(),
  mini: z.boolean().optional(), ph: z.number().min(4).max(100).optional(),
});
const layoutS = z.array(tile).max(60);
const themeS = z.enum(['auto', 'light', 'dark']);
const name = z.string().trim().min(1).max(60);
const items = z.array(z.object({ kioskId: z.string().min(1).max(80), secs: z.number().int().min(3).max(3600) })).max(40);
const deviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

type Row = typeof kiosks.$inferSelect;
const shape = (k: Row, userId: string) => ({
  id: k.id, name: k.name, aspect: k.aspect, theme: k.theme, layout: k.layout as z.infer<typeof layoutS>, updatedAt: k.updatedAt,
  devices: db.select().from(kioskDevices).where(eq(kioskDevices.kioskId, k.id)).all()
    .filter((d) => d.userId === userId).map((d) => ({ deviceId: d.deviceId, label: d.label, lastSeenAt: d.lastSeenAt })),
});

/** Paneles de kiosko de cada usuario (administrador o monitor): solo ve y toca los suyos. */
export const kioskRoutes: FastifyPluginAsync = async (app) => {
  const own = (userId: string, id: string) => db.select().from(kiosks).where(and(eq(kiosks.id, id), eq(kiosks.userId, userId))).get();

  /** Un monitor solo puede poner en su panel lo que tiene asignado. */
  const checkLayout = (user: { id: string; role: string }, layout: z.infer<typeof layoutS>): string | null => {
    if (layout.some((t) => !t.type && !t.elementId)) return 'Falta el elemento de una ficha';
    const ids = [...new Set(layout.filter((t) => !t.type).map((t) => t.elementId))];
    const found = new Set(db.select({ id: elements.id }).from(elements).all().map((e) => e.id));
    if (ids.some((i) => !found.has(i))) return 'Alguno de los elementos no existe';
    const allowed = allowedElementIds(user);
    if (allowed && ids.some((i) => !allowed.has(i))) return 'Alguno de los elementos no está asignado a este usuario';
    return null;
  };

  const mainOf = (userId: string) => {
    const m = db.select().from(kioskMain).where(eq(kioskMain.userId, userId)).get();
    return m ? { kind: m.kind as 'panel' | 'group', id: m.refId } : null;
  };
  const gOwn = (userId: string, id: string) => db.select().from(kioskGroups).where(and(eq(kioskGroups.id, id), eq(kioskGroups.userId, userId))).get();
  const gShape = (g: typeof kioskGroups.$inferSelect, userId: string) => ({
    id: g.id, name: g.name, fx: g.fx, fxKind: g.fxKind, items: g.items as z.infer<typeof items>,
    devices: db.select().from(kioskDeviceGroups).where(eq(kioskDeviceGroups.groupId, g.id)).all()
      .filter((d) => d.userId === userId).map((d) => ({ deviceId: d.deviceId, label: d.label, lastSeenAt: d.lastSeenAt })),
  });

  app.get('/kiosks', { preHandler: requireAuth }, async (req) => ({
    kiosks: db.select().from(kiosks).where(eq(kiosks.userId, req.user!.id)).all().sort((a, b) => a.createdAt - b.createdAt).map((k) => shape(k, req.user!.id)),
    main: mainOf(req.user!.id),
  }));

  /** Kiosko principal: un panel o un grupo (null lo quita). */
  app.put('/kiosks-main', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ kind: z.enum(['panel', 'group', 'none']), id: z.string().max(80).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const uid = req.user!.id;
    if (b.data.kind === 'none') { db.delete(kioskMain).where(eq(kioskMain.userId, uid)).run(); return { main: null }; }
    const ref = b.data.id ?? '';
    const ok = b.data.kind === 'panel' ? own(uid, ref) : gOwn(uid, ref);
    if (!ok) return reply.code(404).send({ error: 'No encontrado' });
    db.delete(kioskMain).where(eq(kioskMain.userId, uid)).run();
    db.insert(kioskMain).values({ userId: uid, kind: b.data.kind, refId: ref }).run();
    return { main: mainOf(uid) };
  });

  /** Lo que reproduce un grupo: sus paneles en orden con el tiempo de cada uno. */
  const play = (g: typeof kioskGroups.$inferSelect, userId: string) => {
    const all = new Map(db.select().from(kiosks).where(eq(kiosks.userId, userId)).all().map((k) => [k.id, k]));
    const steps = (g.items as z.infer<typeof items>).filter((i) => all.has(i.kioskId)).map((i) => ({ secs: i.secs, kiosk: shape(all.get(i.kioskId)!, userId) }));
    return { group: gShape(g, userId), steps };
  };

  app.get('/kiosk-groups', { preHandler: requireAuth }, async (req) => ({
    groups: db.select().from(kioskGroups).where(eq(kioskGroups.userId, req.user!.id)).all().sort((a, b) => a.createdAt - b.createdAt).map((g) => gShape(g, req.user!.id)),
  }));

  app.post('/kiosk-groups', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ name }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    if (db.select().from(kioskGroups).where(eq(kioskGroups.userId, req.user!.id)).all().length >= 20) return reply.code(400).send({ error: 'Hay demasiados grupos' });
    return gShape(db.insert(kioskGroups).values({ userId: req.user!.id, name: b.data.name, items: [] }).returning().get(), req.user!.id);
  });

  app.put<{ Params: { id: string } }>('/kiosk-groups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ name: name.optional(), items: items.optional(), fx: z.number().min(0).max(10).optional(), fxKind: z.enum(['pixels', 'blur', 'none']).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const g = gOwn(req.user!.id, req.params.id);
    if (!g) return reply.code(404).send({ error: 'Grupo no encontrado' });
    if (b.data.items) {
      const mine = new Set(db.select().from(kiosks).where(eq(kiosks.userId, req.user!.id)).all().map((k) => k.id));
      if (b.data.items.some((i) => !mine.has(i.kioskId))) return reply.code(400).send({ error: 'Algún panel no existe' });
    }
    const up = db.update(kioskGroups).set({ ...(b.data.name ? { name: b.data.name } : {}), ...(b.data.items ? { items: b.data.items } : {}), ...(b.data.fx !== undefined ? { fx: b.data.fx } : {}), ...(b.data.fxKind ? { fxKind: b.data.fxKind } : {}) }).where(eq(kioskGroups.id, g.id)).returning().get();
    return gShape(up, req.user!.id);
  });

  app.delete<{ Params: { id: string } }>('/kiosk-groups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const g = gOwn(req.user!.id, req.params.id);
    if (!g) return reply.code(404).send({ error: 'Grupo no encontrado' });
    db.delete(kioskMain).where(and(eq(kioskMain.userId, req.user!.id), eq(kioskMain.kind, 'group'), eq(kioskMain.refId, g.id))).run();
    db.delete(kioskGroups).where(eq(kioskGroups.id, g.id)).run();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/kiosk-groups/:id/play', { preHandler: requireAuth }, async (req, reply) => {
    const g = gOwn(req.user!.id, req.params.id);
    if (!g) return reply.code(404).send({ error: 'Grupo no encontrado' });
    return play(g, req.user!.id);
  });

  app.put<{ Params: { id: string } }>('/kiosk-groups/:id/device', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ deviceId, label: z.string().trim().max(60).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const g = gOwn(req.user!.id, req.params.id);
    if (!g) return reply.code(404).send({ error: 'Grupo no encontrado' });
    const uid = req.user!.id;
    db.delete(kioskDevices).where(and(eq(kioskDevices.userId, uid), eq(kioskDevices.deviceId, b.data.deviceId))).run();
    db.delete(kioskDeviceGroups).where(and(eq(kioskDeviceGroups.userId, uid), eq(kioskDeviceGroups.deviceId, b.data.deviceId))).run();
    db.insert(kioskDeviceGroups).values({ userId: uid, deviceId: b.data.deviceId, groupId: g.id, label: b.data.label ?? null }).run();
    return gShape(g, uid);
  });

  app.post('/kiosks', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ name, aspect: z.number().min(0.3).max(4).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    if (db.select().from(kiosks).where(eq(kiosks.userId, req.user!.id)).all().length >= 30) return reply.code(400).send({ error: 'Hay demasiados paneles' });
    const k = db.insert(kiosks).values({ userId: req.user!.id, name: b.data.name, aspect: b.data.aspect ?? 1.78, layout: [] }).returning().get();
    return shape(k, req.user!.id);
  });

  app.put<{ Params: { id: string } }>('/kiosks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ name: name.optional(), aspect: z.number().min(0.3).max(4).optional(), layout: layoutS.optional(), theme: themeS.optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const k = own(req.user!.id, req.params.id);
    if (!k) return reply.code(404).send({ error: 'Panel no encontrado' });
    if (b.data.layout) { const e = checkLayout(req.user!, b.data.layout); if (e) return reply.code(400).send({ error: e }); }
    const up = db.update(kiosks).set({
      ...(b.data.name ? { name: b.data.name } : {}), ...(b.data.aspect ? { aspect: b.data.aspect } : {}),
      ...(b.data.layout ? { layout: b.data.layout } : {}), ...(b.data.theme ? { theme: b.data.theme } : {}), updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(kiosks.id, k.id)).returning().get();
    return shape(up, req.user!.id);
  });

  app.delete<{ Params: { id: string } }>('/kiosks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const k = own(req.user!.id, req.params.id);
    if (!k) return reply.code(404).send({ error: 'Panel no encontrado' });
    db.delete(kioskMain).where(and(eq(kioskMain.userId, req.user!.id), eq(kioskMain.kind, 'panel'), eq(kioskMain.refId, k.id))).run();
    db.delete(kiosks).where(eq(kiosks.id, k.id)).run();
    return { ok: true };
  });

  /** Panel que debe abrir este dispositivo (null si aún no tiene ninguno asignado). */
  app.get<{ Params: { deviceId: string } }>('/kiosks/device/:deviceId', { preHandler: requireAuth }, async (req, reply) => {
    const d = deviceId.safeParse(req.params.deviceId);
    if (!d.success) return reply.code(400).send({ error: 'Dispositivo no válido' });
    const a = db.select().from(kioskDevices).where(and(eq(kioskDevices.userId, req.user!.id), eq(kioskDevices.deviceId, d.data))).get();
    if (!a) {
      const ga = db.select().from(kioskDeviceGroups).where(and(eq(kioskDeviceGroups.userId, req.user!.id), eq(kioskDeviceGroups.deviceId, d.data))).get();
      const g = ga ? gOwn(req.user!.id, ga.groupId) : undefined;
      if (ga && g) {
        db.update(kioskDeviceGroups).set({ lastSeenAt: Math.floor(Date.now() / 1000) }).where(and(eq(kioskDeviceGroups.userId, ga.userId), eq(kioskDeviceGroups.deviceId, ga.deviceId))).run();
        return { kiosk: null, group: gShape(g, req.user!.id) };
      }
    }
    const k = a ? own(req.user!.id, a.kioskId) : undefined;
    if (a && k) db.update(kioskDevices).set({ lastSeenAt: Math.floor(Date.now() / 1000) }).where(and(eq(kioskDevices.userId, a.userId), eq(kioskDevices.deviceId, a.deviceId))).run();
    return { kiosk: k ? shape(k, req.user!.id) : null };
  });

  /** Asigna este dispositivo a un panel (si ya tenía otro, lo cambia). */
  app.put<{ Params: { id: string } }>('/kiosks/:id/device', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ deviceId, label: z.string().trim().max(60).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Datos no válidos' });
    const k = own(req.user!.id, req.params.id);
    if (!k) return reply.code(404).send({ error: 'Panel no encontrado' });
    db.delete(kioskDevices).where(and(eq(kioskDevices.userId, req.user!.id), eq(kioskDevices.deviceId, b.data.deviceId))).run();
    db.delete(kioskDeviceGroups).where(and(eq(kioskDeviceGroups.userId, req.user!.id), eq(kioskDeviceGroups.deviceId, b.data.deviceId))).run();
    db.insert(kioskDevices).values({ userId: req.user!.id, deviceId: b.data.deviceId, kioskId: k.id, label: b.data.label ?? null }).run();
    return shape(k, req.user!.id);
  });

  app.delete<{ Params: { deviceId: string } }>('/kiosks/device/:deviceId', { preHandler: requireAuth }, async (req, reply) => {
    const d = deviceId.safeParse(req.params.deviceId);
    if (!d.success) return reply.code(400).send({ error: 'Dispositivo no válido' });
    db.delete(kioskDevices).where(and(eq(kioskDevices.userId, req.user!.id), eq(kioskDevices.deviceId, d.data))).run();
    db.delete(kioskDeviceGroups).where(and(eq(kioskDeviceGroups.userId, req.user!.id), eq(kioskDeviceGroups.deviceId, d.data))).run();
    return { ok: true };
  });
};
