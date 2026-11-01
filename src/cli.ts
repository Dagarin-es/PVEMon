/**
 * Utilidades de consola (se ejecutan dentro del contenedor):
 *   node dist/cli.js create-admin <usuario>
 *   node dist/cli.js reset-password <usuario>
 * Imprimen una contraseña aleatoria UNA vez; cámbiala después en la app.
 */
import { eq } from 'drizzle-orm';
import { generatePassword, hashPassword } from './auth/password.js';
import { deleteUserSessions } from './auth/sessions.js';
import { db, schema } from './db/index.js';
import { runMigrations } from './db/migrations.js';

const [cmd, rawName] = process.argv.slice(2);
const username = rawName?.trim().toLowerCase();
const { users } = schema;

if (!cmd || !username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('Uso: cli.js <create-admin|reset-password> <usuario (3-32: a-z 0-9 . _ -)>');
  process.exit(1);
}

runMigrations();
if (cmd === 'reset-2fa') {
  const u = db.select().from(users).where(eq(users.username, username)).get();
  if (!u) { console.error(`El usuario "${username}" no existe`); process.exit(1); }
  db.update(users).set({ totpSecretEnc: null }).where(eq(users.id, u.id)).run();
  console.log(`Verificación en dos pasos desactivada para ${username}`);
  process.exit(0);
}
const password = generatePassword();
const passwordHash = await hashPassword(password);
const existing = db.select().from(users).where(eq(users.username, username)).get();

if (cmd === 'create-admin') {
  if (existing) { console.error(`El usuario "${username}" ya existe`); process.exit(1); }
  db.insert(users).values({ username, passwordHash, role: 'admin' }).run();
} else if (cmd === 'reset-password') {
  if (!existing) { console.error(`El usuario "${username}" no existe`); process.exit(1); }
  db.update(users).set({ passwordHash, disabled: false }).where(eq(users.id, existing.id)).run();
  deleteUserSessions(existing.id);
} else {
  console.error(`Comando desconocido: ${cmd}`); process.exit(1);
}

console.log(`\nUsuario:    ${username}\nContraseña: ${password}\n\nGuárdala ahora: no se vuelve a mostrar.\n`);
