import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Elementos que un usuario puede ver. null = todos (administrador).
 * El acceso es explícito, elemento a elemento: el panel de administración marca de golpe
 * lo que cuelga de un servidor o nodo, y el administrador desmarca lo que no quiera.
 * (Lo que se descubra después en un servidor no es visible para un Monitor hasta concedérselo.)
 */
export function allowedElementIds(user: { id: string; role: string }): Set<string> | null {
  if (user.role === 'admin') return null;
  return new Set(
    db.select({ id: schema.elementAccess.elementId }).from(schema.elementAccess)
      .where(eq(schema.elementAccess.userId, user.id)).all().map((r) => r.id),
  );
}
