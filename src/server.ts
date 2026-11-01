import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { EDITION, PAL_DEFAULT, brandScript, isPalette, manifest } from './edition.js';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { purgeExpiredSessions } from './auth/sessions.js';
import { config } from './config.js';
import { assertSecretKey } from './crypto.js';
import './db/index.js'; // abre la BD de configuración
import { runMigrations } from './db/migrations.js';
import { SqliteMetricsStore, type MetricsStore } from './metrics/store.js';
import { startAlerts } from './alerts/engine.js';
import { startCollector } from './proxmox/collector.js';
import { startBackupMonitor } from './backups/collector.js';
import { startMailMonitor } from './mail/monitor.js';
import { startFileChecks } from './filecheck/monitor.js';
import { filecheckRoutes } from './routes/filecheck.js';
import { avatarRoutes } from './routes/avatar.js';
import { mailRoutes } from './routes/mail.js';
import { overviewRoutes } from './routes/overview.js';
import { kioskRoutes } from './routes/kiosks.js';
import { diskRoutes } from './routes/disks.js';
import { apiV1Routes } from './routes/apiv1.js';
import { startUpdateWatcher } from './update/service.js';
import { startLanScan } from './discovery/lan.js';
import { startDockerCollector } from './docker/collector.js';
import { startScheduler } from './proxmox/scheduler.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { deliveryRoutes } from './routes/delivery.js';
import { dockerRoutes } from './routes/docker.js';
import { elementRoutes } from './routes/elements.js';
import { notificationRoutes } from './routes/notifications.js';
import { serverRoutes } from './routes/servers.js';
import { serverUpdateRoutes } from './routes/serverUpdate.js';
import { systemRoutes } from './routes/system.js';
import { startHeartbeat } from './system/heartbeat.js';
import { startDigest } from './system/digest.js';
import { healthRoutes } from './routes/health.js';
import { metricRoutes } from './routes/metrics.js';
import { userRoutes } from './routes/users.js';
import { clientDictScript, parseLang, trDeep } from './i18n.js';

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsStore;
  }
}

assertSecretKey(); // falla pronto y con un mensaje claro si falta SECRET_KEY
runMigrations();

const app = Fastify({ logger: true, trustProxy: true }); // detrás de Nginx Proxy Manager
app.decorateRequest('user', null);
app.decorateRequest('sessionId', null);

/* Idioma: el navegador manda X-Lang; con «en» se traducen los textos de las respuestas JSON (errores, alertas, mensajes…) */
app.addHook('onSend', async (req, reply, payload) => {
  if (typeof payload !== 'string' || parseLang(req.headers['x-lang']) !== 'en') return payload;
  if (!req.url.startsWith('/api/') || req.url.startsWith('/api/v1/')) return payload;
  if (!String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload;
  try { return JSON.stringify(trDeep(JSON.parse(payload), 'en')); } catch { return payload; }
});

/* Diccionario inglés del navegador (se carga de forma síncrona antes de la pantalla) */
app.get('/i18n/en.js', async (_req, reply) => reply.header('Content-Type', 'application/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(clientDictScript()));

// (los hooks de idioma van antes que la compresión: así ven el JSON sin comprimir)

await app.register(compress, { threshold: 1024 }); // gzip/brotli: index.html pasa de ~89 KB a ~20 KB
await app.register(cookie);
await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' }); // tope general por IP; el login y las pruebas tienen el suyo, más estricto

/* Cabeceras de seguridad en todas las respuestas */
app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=15552000'); // 180 días; solo si se accede por HTTPS
});

/* Defensa extra contra peticiones de otros sitios (además de la cookie SameSite=Strict).
 * Se acepta si el navegador declara misma-origen (Sec-Fetch-Site) o si el Origin coincide con el
 * Host / X-Forwarded-Host (con o sin puerto): así no falla detrás de proxies, VPN o redes de empresa. */
const hostOnly = (h: string) => h.toLowerCase().replace(/:\d+$/, '');
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (!origin) return;
  const sfs = req.headers['sec-fetch-site'];
  if (sfs === 'same-origin' || sfs === 'none') return;
  let oh = '';
  try { oh = new URL(origin).host; } catch { /* origen ilegible */ }
  const fwd = String(req.headers['x-forwarded-host'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const ok = [req.headers.host ?? '', ...fwd].some((h) => h && (h.toLowerCase() === oh.toLowerCase() || hostOnly(h) === hostOnly(oh)));
  if (!ok) {
    req.log.warn({ origin, host: req.headers.host, fwd, sfs }, 'Origen rechazado');
    return reply.code(403).send({ error: 'Origen no permitido' });
  }
});


/* Los errores internos no cuentan detalles al cliente */
app.setErrorHandler((err, req, reply) => {
  const code = (err as { statusCode?: number }).statusCode ?? 500;
  if (code >= 500) {
    req.log.error({ err }, 'error interno');
    return reply.code(code).send({ error: 'Error interno' });
  }
  if (code === 429) return reply.code(429).send({ error: 'Demasiados intentos en poco tiempo. Espera un minuto y vuelve a probar.' });
  return reply.code(code).send({ error: (err as Error).message });
});

const metrics = new SqliteMetricsStore(config.metricsDbPath);
app.decorate('metrics', metrics);

await app.register(healthRoutes, { prefix: '/api' });
await app.register(authRoutes, { prefix: '/api' });
await app.register(userRoutes, { prefix: '/api' });
await app.register(avatarRoutes, { prefix: '/api' });
if (EDITION === 'pvemon') await app.register(serverRoutes, { prefix: '/api' });
if (EDITION === 'pvemon') await app.register(serverUpdateRoutes, { prefix: '/api' });
await app.register(systemRoutes, { prefix: '/api' });
await app.register(elementRoutes, { prefix: '/api' });
await app.register(metricRoutes, { prefix: '/api' });
await app.register(notificationRoutes, { prefix: '/api' });
await app.register(alertRoutes, { prefix: '/api' });
await app.register(deliveryRoutes, { prefix: '/api' });
if (EDITION === 'pvemon') await app.register(dockerRoutes, { prefix: '/api' });
await app.register(mailRoutes, { prefix: '/api' });
await app.register(filecheckRoutes, { prefix: '/api' });
await app.register(overviewRoutes, { prefix: '/api' });
await app.register(kioskRoutes, { prefix: '/api' });
if (EDITION === 'pvemon') await app.register(diskRoutes, { prefix: '/api' });
await app.register(apiV1Routes, { prefix: '/api' });
// Marca de la edición: script, manifiesto e iconos propios (PVEMon por defecto; BCKMon con EDITION=bckmon)
app.get('/brand.js', async (_req, reply) => reply.header('Cache-Control', 'no-cache').type('application/javascript; charset=utf-8').send(brandScript()));
app.get('/manifest.webmanifest', async (req, reply) => {
  const p = (req.query as { p?: string }).p;
  return reply.header('Cache-Control', 'no-cache').type('application/manifest+json').send(manifest(isPalette(p) ? p : PAL_DEFAULT));
});
// Iconos según edición y paleta (?p=). PVEMon con su paleta original (aurora) sigue sirviendo los iconos de siempre de public/
for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'badge-96.png']) {
  app.get('/' + f, async (req, reply) => {
    const q = (req.query as { p?: string }).p;
    const pal = isPalette(q) ? q : PAL_DEFAULT;
    const file = EDITION === 'pvemon' && pal === 'aurora' ? f : `palettes/${EDITION}/${pal}/${f}`;
    return reply.header('Cache-Control', 'public, max-age=3600').sendFile(file);
  });
}
await app.register(fastifyStatic, {
  root: resolve('public'), // la PWA
  cacheControl: false,
  setHeaders: (res, path) => {
    // tipografías e iconos casi nunca cambian; el resto se revalida siempre (ETag) para que las actualizaciones lleguen al instante
    res.header('Cache-Control', /\/fonts\/|\.(png|svg)$/.test(path) ? 'public, max-age=2592000' : 'no-cache');
  },
});
const noop = () => undefined;
const PVE = EDITION === 'pvemon'; // BCKMon no habla con Proxmox, ni con Docker, ni explora la red
const stopScheduler = PVE ? startScheduler(app.log) : noop;
const stopAlerts = startAlerts(app.log);
const stopCollector = PVE ? startCollector(app.log, metrics) : noop;
const stopDocker = PVE ? startDockerCollector(app.log, metrics) : noop;
const stopLan = PVE ? startLanScan(app.log) : noop;
const stopBackups = PVE ? startBackupMonitor(app.log, metrics) : noop;
const stopMail = startMailMonitor(app.log, metrics);
const stopFiles = startFileChecks(app.log, metrics);
const stopHeartbeat = startHeartbeat(app.log);
const stopDigest = startDigest(app.log);
const stopUpdates = PVE ? startUpdateWatcher(app.log) : noop;

// Mantenimiento: agregación de métricas y sesiones caducadas, cada 5 min
const timer = setInterval(() => {
  try { metrics.maintain(); purgeExpiredSessions(); } catch (err) { app.log.error(err, 'mantenimiento falló'); }
}, 5 * 60_000);

app.addHook('onClose', async () => {
  clearInterval(timer);
  stopScheduler();
  stopCollector();
  stopDocker();
  stopLan();
  stopBackups();
  stopMail(); stopFiles();
  stopHeartbeat();
  stopDigest();
  stopUpdates();
  stopAlerts();
  metrics.close();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ host: config.host, port: config.port });
