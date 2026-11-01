import { db, schema } from '../db/index.js';

export function audit(userId: string | null, action: string, target?: string, detail?: Record<string, unknown>) {
  db.insert(schema.auditLog).values({ userId, action, target, detail }).run();
}
