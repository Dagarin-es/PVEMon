/**
 * Almacén de series temporales.
 *
 * TODA la app habla con la interfaz MetricsStore, nunca con SQL de métricas.
 * Hoy: SQLite (fichero aparte). Si algún día hace falta, se escribe otra
 * implementación (TimescaleDB, VictoriaMetrics...) sin tocar el resto.
 */
import type Database from 'better-sqlite3';
import { openSqlite } from '../db/index.js';

export interface Point {
  elementId: string;
  metricKey: string;
  ts: number; // epoch segundos
  value: number;
}

export interface SeriesPoint {
  ts: number;
  avg: number;
  min: number;
  max: number;
}

export interface QueryOptions {
  elementId: string;
  metricKey: string;
  from: number;
  to: number;
  maxPoints?: number; // para no mandar miles de puntos al móvil
}

export interface MetricsStore {
  /** Escritura por lotes: una transacción por ciclo de recogida. */
  write(points: Point[]): void;
  query(opts: QueryOptions): SeriesPoint[];
  latest(elementId: string, metricKeys: string[]): Record<string, { ts: number; value: number }>;
  /** Agrega crudo → 5 min → 1 h y borra lo caducado. Se llama cada pocos minutos. */
  maintain(nowSec?: number): void;
  close(): void;
}

/** Retención (segundos). Configurable más adelante desde ajustes. */
export const RETENTION = {
  raw: 48 * 3600,
  m5: 30 * 24 * 3600,
  h1: 180 * 24 * 3600,
} as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS series (
  id         INTEGER PRIMARY KEY,
  element_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  UNIQUE (element_id, metric_key)
);
CREATE TABLE IF NOT EXISTS samples_raw (
  series_id INTEGER NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS samples_5m (
  series_id INTEGER NOT NULL, ts INTEGER NOT NULL,
  avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS samples_1h (
  series_id INTEGER NOT NULL, ts INTEGER NOT NULL,
  avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

export class SqliteMetricsStore implements MetricsStore {
  private db: Database.Database;
  private seriesCache = new Map<string, number>();
  private insertRaw: Database.Statement;
  private selectSeries: Database.Statement;
  private insertSeries: Database.Statement;

  constructor(path: string) {
    this.db = openSqlite(path);
    this.db.exec(SCHEMA);
    this.insertRaw = this.db.prepare(
      'INSERT OR REPLACE INTO samples_raw (series_id, ts, value) VALUES (?, ?, ?)',
    );
    this.selectSeries = this.db.prepare(
      'SELECT id FROM series WHERE element_id = ? AND metric_key = ?',
    );
    this.insertSeries = this.db.prepare(
      'INSERT INTO series (element_id, metric_key) VALUES (?, ?)',
    );
  }

  private seriesId(elementId: string, metricKey: string): number {
    const k = `${elementId}|${metricKey}`;
    let id = this.seriesCache.get(k);
    if (id !== undefined) return id;
    const row = this.selectSeries.get(elementId, metricKey) as { id: number } | undefined;
    id = row ? row.id : Number(this.insertSeries.run(elementId, metricKey).lastInsertRowid);
    this.seriesCache.set(k, id);
    return id;
  }

  write(points: Point[]): void {
    if (points.length === 0) return;
    this.db.transaction(() => {
      for (const p of points) {
        this.insertRaw.run(this.seriesId(p.elementId, p.metricKey), p.ts, p.value);
      }
    })();
  }

  query({ elementId, metricKey, from, to, maxPoints = 300 }: QueryOptions): SeriesPoint[] {
    const row = this.selectSeries.get(elementId, metricKey) as { id: number } | undefined;
    if (!row) return [];
    const span = to - from;
    const bucket = Math.max(1, Math.ceil(span / maxPoints));
    const now = Math.floor(Date.now() / 1000);

    // Elegir la tabla más fina que aún conserve ese rango
    let table = 'samples_raw';
    if (from < now - RETENTION.raw) table = 'samples_5m';
    if (from < now - RETENTION.m5) table = 'samples_1h';

    const sql =
      table === 'samples_raw'
        ? `SELECT (ts / CAST(@b AS INTEGER)) * CAST(@b AS INTEGER) AS ts, AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max
           FROM samples_raw WHERE series_id = @id AND ts BETWEEN @from AND @to GROUP BY 1 ORDER BY 1`
        : `SELECT (ts / CAST(@b AS INTEGER)) * CAST(@b AS INTEGER) AS ts, AVG(avg) AS avg, MIN(min) AS min, MAX(max) AS max
           FROM ${table} WHERE series_id = @id AND ts BETWEEN @from AND @to GROUP BY 1 ORDER BY 1`;
    return this.db.prepare(sql).all({ b: bucket, id: row.id, from, to }) as SeriesPoint[];
  }

  latest(elementId: string, metricKeys: string[]) {
    const out: Record<string, { ts: number; value: number }> = {};
    const stmt = this.db.prepare(
      `SELECT r.ts, r.value FROM samples_raw r JOIN series s ON s.id = r.series_id
       WHERE s.element_id = ? AND s.metric_key = ? ORDER BY r.ts DESC LIMIT 1`,
    );
    for (const key of metricKeys) {
      const r = stmt.get(elementId, key) as { ts: number; value: number } | undefined;
      if (r) out[key] = r;
    }
    return out;
  }

  maintain(nowSec = Math.floor(Date.now() / 1000)): void {
    const getMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    const setMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    const roll = (src: string, dst: string, step: number, metaKey: string, srcIsRaw: boolean) => {
      const upTo = Math.floor(nowSec / step) * step; // solo cubos completos
      const last = (getMeta.get(metaKey) as { value: number } | undefined)?.value ?? 0;
      if (upTo <= last) return;
      const agg = srcIsRaw
        ? 'AVG(value), MIN(value), MAX(value)'
        : 'AVG(avg), MIN(min), MAX(max)';
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${dst} (series_id, ts, avg, min, max)
           SELECT series_id, (ts / ${step}) * ${step}, ${agg} FROM ${src}
           WHERE ts >= ? AND ts < ? GROUP BY series_id, (ts / ${step}) * ${step}`,
        )
        .run(last, upTo);
      setMeta.run(metaKey, upTo);
    };
    this.db.transaction(() => {
      roll('samples_raw', 'samples_5m', 300, 'rolled_5m', true);
      roll('samples_5m', 'samples_1h', 3600, 'rolled_1h', false);
      this.db.prepare('DELETE FROM samples_raw WHERE ts < ?').run(nowSec - RETENTION.raw);
      this.db.prepare('DELETE FROM samples_5m WHERE ts < ?').run(nowSec - RETENTION.m5);
      this.db.prepare('DELETE FROM samples_1h WHERE ts < ?').run(nowSec - RETENTION.h1);
    })();
  }

  close(): void {
    this.db.close();
  }
}
