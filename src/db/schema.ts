/**
 * BD de CONFIGURACIÓN (pequeña, cambia poco).
 * Las series temporales viven en otra BD: ver src/metrics/store.ts.
 *
 * Reglas para mantenerlo portable a PostgreSQL:
 *  - ids UUID (texto), nunca autoincrementales
 *  - fechas como enteros (epoch en segundos)
 *  - JSON como texto con tipo (mode: 'json')
 *  - nada de funciones específicas de SQLite
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const now = () => sql`(unixepoch())`;

export type Role = 'admin' | 'monitor';
export type ElementKind = 'server' | 'node' | 'vm' | 'lxc' | 'docker' | 'backup';
export type ElementStatus = 'running' | 'stopped' | 'paused' | 'restarting' | 'unknown';

/* ───────────── Usuarios y sesiones ───────────── */

export const users = sqliteTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  email: text('email'),
  passwordHash: text('password_hash').notNull(), // argon2id
  role: text('role').$type<Role>().notNull().default('monitor'),
  totpSecretEnc: text('totp_secret_enc'), // cifrado; null = sin 2FA
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().default(now()),
  lastLoginAt: integer('last_login_at'),
  lang: text('lang'), // idioma elegido: 'es' | 'en' (null = castellano)
});

/** Foto de perfil ya recortada (JPEG pequeño). En tabla aparte para no cargarla en cada consulta de usuarios. */
export const userAvatars = sqliteTable('user_avatars', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  data: blob('data', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at').notNull().default(now()),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // hash del token de sesión, no el token
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().default(now()),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_exp_idx').on(t.expiresAt)],
);

/* ───────────── Servidores Proxmox (conexiones) ───────────── */

export const servers = sqliteTable('servers', {
  id: id(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(), // https://ip:8006
  tokenId: text('token_id').notNull(), // user@realm!tokenid
  tokenSecretEnc: text('token_secret_enc').notNull(), // cifrado con SECRET_KEY
  verifyTls: integer('verify_tls', { mode: 'boolean' }).notNull().default(false),
  tlsFingerprint: text('tls_fingerprint'), // para fijar certificado autofirmado
  pollIntervalSec: integer('poll_interval_sec').notNull().default(30),
  pveVersion: text('pve_version'),
  status: text('status').$type<'online' | 'offline' | 'unknown'>().notNull().default('unknown'),
  lastSeenAt: integer('last_seen_at'),
  lastError: text('last_error'),
  /** 'manual' = dado de alta por un administrador; 'auto' queda para un descubrimiento futuro */
  source: text('source').$type<'manual' | 'auto'>().notNull().default('manual'),
  /** Una copia más antigua que esto (en horas) se considera fallo. 192 h = 8 días. */
  backupMaxHours: integer('backup_max_hours').notNull().default(192),
  /** 'proxmox' = servidor real; 'mail' = origen de copias (un NAS) que se vigila por correo */
  kind: text('kind').$type<'proxmox' | 'mail'>().notNull().default('proxmox'),
  createdAt: integer('created_at').notNull().default(now()),
});

/* ───────────── Árbol de elementos ─────────────
 * server → node → (vm | lxc) → docker
 * Una única tabla en árbol: los permisos, las métricas y las vistas
 * referencian siempre un element_id, sea del tipo que sea.
 */

export const elements = sqliteTable(
  'elements',
  {
    id: id(),
    serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'), // null = raíz (el propio server)
    kind: text('kind').$type<ElementKind>().notNull(),
    externalId: text('external_id').notNull(), // vmid, nombre de nodo, id de contenedor...
    name: text('name').notNull(),
    /** Nombre puesto por el administrador; el descubrimiento nunca lo toca. */
    alias: text('alias'),
    status: text('status').$type<ElementStatus>().notNull().default('unknown'),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(false),
    isNew: integer('is_new', { mode: 'boolean' }).notNull().default(true), // recién descubierto, sin revisar
    missing: integer('missing', { mode: 'boolean' }).notNull().default(false), // ya no aparece en el inventario
    /** Datos descubiertos: SO, recursos asignados, imagen Docker, hardware... */
    info: text('info', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: integer('first_seen_at').notNull().default(now()),
    lastSeenAt: integer('last_seen_at').notNull().default(now()),
  },
  (t) => [
    uniqueIndex('elements_identity_uq').on(t.serverId, t.kind, t.externalId, t.parentId),
    index('elements_parent_idx').on(t.parentId),
    index('elements_server_idx').on(t.serverId),
  ],
);

/** Endpoint docker-socket-proxy de una VM/LXC (descubierto o manual). */
export const dockerEndpoints = sqliteTable('docker_endpoints', {
  elementId: text('element_id')
    .primaryKey()
    .references(() => elements.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  port: integer('port').notNull().default(2375),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status').$type<'ok' | 'unreachable' | 'unknown'>().notNull().default('unknown'),
  lastCheckAt: integer('last_check_at'),
  lastError: text('last_error'),
  /** 'auto' = lo encontró pvemon solo; 'manual' = lo indicó un administrador */
  source: text('source').$type<'auto' | 'manual'>().notNull().default('manual'),
});

/* ───────────── Permisos (rol Monitor) ─────────────
 * Un permiso sobre un elemento se hereda a todos sus descendientes.
 * Los administradores no necesitan filas aquí: lo ven todo.
 */
export const elementAccess = sqliteTable(
  'element_access',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull().references(() => elements.id, { onDelete: 'cascade' }),
    grantedAt: integer('granted_at').notNull().default(now()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.elementId] })],
);

/* ───────────── Métricas elegidas por elemento ─────────────
 * El catálogo de métricas posibles está en código (metrics/catalog.ts).
 * Aquí solo se guarda qué ha activado el usuario y cómo verlo.
 */
export const elementMetrics = sqliteTable(
  'element_metrics',
  {
    elementId: text('element_id').notNull().references(() => elements.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(), // p.ej. 'cpu.usage'
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    widget: text('widget').$type<'gauge' | 'line' | 'chip' | 'number'>(), // null = el del catálogo
    thresholds: text('thresholds', { mode: 'json' }).$type<{ warn?: number; crit?: number }>(),
  },
  (t) => [primaryKey({ columns: [t.elementId, t.metricKey] })],
);

/* ───────────── Vistas / paneles ───────────── */

export const dashboards = sqliteTable('dashboards', {
  id: id(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Si no es null, es la vista automática de ese elemento. */
  autoForElementId: text('auto_for_element_id').references(() => elements.id, { onDelete: 'cascade' }),
  /** Widgets: [{ elementId, metricKey, widget, x, y, w, h }] */
  layout: text('layout', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now()),
  updatedAt: integer('updated_at').notNull().default(now()),
});

/* ───────────── Alertas y notificaciones ───────────── */

export const alertRules = sqliteTable('alert_rules', {
  id: id(),
  name: text('name').notNull(),
  /** Alcance: un elemento concreto, o todos los de un tipo. */
  elementId: text('element_id').references(() => elements.id, { onDelete: 'cascade' }),
  elementKind: text('element_kind').$type<ElementKind>(),
  metricKey: text('metric_key').notNull(),
  operator: text('operator').$type<'>' | '<' | '=='>().notNull(),
  threshold: integer('threshold').notNull(),
  forSeconds: integer('for_seconds').notNull().default(120), // debe mantenerse N s antes de disparar
  severity: text('severity').$type<'warning' | 'critical'>().notNull().default('warning'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now()),
});

export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: id(),
    ruleId: text('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull().references(() => elements.id, { onDelete: 'cascade' }),
    state: text('state').$type<'firing' | 'resolved'>().notNull(),
    value: text('value'),
    startedAt: integer('started_at').notNull().default(now()),
    resolvedAt: integer('resolved_at'),
    notifiedAt: integer('notified_at'),
    /** Alerta pospuesta: hasta esta hora no cuenta como activa ni avisa */
    snoozedUntil: integer('snoozed_until'),
  },
  (t) => [index('alert_events_state_idx').on(t.state, t.startedAt)],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint)],
);

/** Avisos que recibe cada usuario por elemento: push, correo, ambos o ninguno (sin fila = ninguno). */
export const notificationPrefs = sqliteTable(
  'notification_prefs',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull().references(() => elements.id, { onDelete: 'cascade' }),
    push: integer('push', { mode: 'boolean' }).notNull().default(false),
    email: integer('email', { mode: 'boolean' }).notNull().default(false),
    telegram: integer('telegram', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.elementId] })],
);

/* ───────────── Copias de seguridad (última copia de cada VM/LXC) ───────────── */

export type BackupState = 'ok' | 'error' | 'stale' | 'none' | 'excluded';

export const backupStatus = sqliteTable('backup_status', {
  elementId: text('element_id').primaryKey().references(() => elements.id, { onDelete: 'cascade' }),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  state: text('state').$type<BackupState>().notNull(),
  lastOkAt: integer('last_ok_at'),
  lastOkSize: integer('last_ok_size'),
  lastOkStorage: text('last_ok_storage'),
  lastAttemptAt: integer('last_attempt_at'),
  lastAttemptOk: integer('last_attempt_ok', { mode: 'boolean' }),
  message: text('message'),
  checkedAt: integer('checked_at').notNull(),
  /** Límite propio de esta copia (horas); si es null vale el del servidor/origen */
  maxHoursOverride: integer('max_hours_override'),
});

/** Correos de copias ya interpretados (uno por mensaje). */
export const mailEvents = sqliteTable(
  'mail_events',
  {
    id: id(),
    elementId: text('element_id').notNull().references(() => elements.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull().unique(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    at: integer('at').notNull(),
    detail: text('detail'),
    /** Remitente del correo (para poder retirar los de remitentes excluidos después) */
    sender: text('sender'),
    /** Tamaño de la copia en bytes, si el correo lo trae */
    size: integer('size'),
  },
  (t) => [index('mail_events_el_idx').on(t.elementId, t.at)],
);

/* ───────────── Ajustes globales y auditoría ───────────── */

/** SMTP, claves VAPID, retención de métricas, etc. Los secretos van cifrados. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull().default(now()),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // 'user.create', 'server.add', 'login.fail'...
    target: text('target'),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
    at: integer('at').notNull().default(now()),
  },
  (t) => [index('audit_at_idx').on(t.at)],
);

/* ───────────── Modo kiosko ─────────────
 * Un usuario puede tener varios paneles (uno por dispositivo). `layout` guarda el lienzo:
 * posiciones y tamaños en % del lienzo, para que se adapte a la pantalla donde se muestre.
 */
export const kiosks = sqliteTable(
  'kiosks',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Relación ancho/alto de la pantalla para la que se diseñó (p. ej. 1.78) */
    aspect: real('aspect').notNull().default(1.78),
    layout: text('layout', { mode: 'json' }).$type<unknown>().notNull().default(sql`'[]'`),
    /** Tema del panel: auto (el del dispositivo), light u dark */
    theme: text('theme').notNull().default('auto'),
    createdAt: integer('created_at').notNull().default(now()),
    updatedAt: integer('updated_at').notNull().default(now()),
  },
  (t) => [index('kiosks_user_idx').on(t.userId)],
);

/** Qué panel abre cada dispositivo (identificado por un código que guarda su navegador). */
export const kioskDevices = sqliteTable(
  'kiosk_devices',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    kioskId: text('kiosk_id').notNull().references(() => kiosks.id, { onDelete: 'cascade' }),
    label: text('label'),
    lastSeenAt: integer('last_seen_at').notNull().default(now()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);

/** Grupos de paneles que rotan solos: items = [{kioskId, secs}] en orden. */
export const kioskGroups = sqliteTable(
  'kiosk_groups',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    items: text('items', { mode: 'json' }).$type<unknown>().notNull().default(sql`'[]'`),
    /** Segundos de la transición entre paneles (0 = cambio directo) */
    fx: real('fx').notNull().default(2),
    /** Efecto: pixels (difusión de píxeles), blur (desenfoque) o none */
    fxKind: text('fx_kind').notNull().default('pixels'),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => [index('kiosk_groups_user_idx').on(t.userId)],
);

/** Dispositivos que abren un grupo rotativo en vez de un panel suelto. */
export const kioskDeviceGroups = sqliteTable(
  'kiosk_device_groups',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    groupId: text('group_id').notNull().references(() => kioskGroups.id, { onDelete: 'cascade' }),
    label: text('label'),
    lastSeenAt: integer('last_seen_at').notNull().default(now()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);

/** Kiosko principal de cada usuario (un panel o un grupo): lo abre el botón «Kiosko». */
export const kioskMain = sqliteTable('kiosk_main', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  refId: text('ref_id').notNull(),
});

/** Último estado de los discos de cada nodo (SMART, desgaste, temperatura, ZFS) leído de la API de Proxmox. */
export const nodeDisks = sqliteTable('node_disks', {
  elementId: text('element_id').primaryKey().references(() => elements.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull().default(now()),
});
