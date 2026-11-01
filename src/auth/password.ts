import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt (nativo de Node, sin dependencias compiladas). Parámetros N=2^15, r=8, p=1.
const N = 32768, R = 8, P = 1, KEYLEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((res, rej) =>
    scrypt(password, salt, KEYLEN, opts, (err, key) => (err ? rej(err) : res(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), +n, +r, +p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash falso para gastar el mismo tiempo cuando el usuario no existe (evita enumerar usuarios). */
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;

export const MIN_PASSWORD_LENGTH = 12;
export const generatePassword = () => randomBytes(15).toString('base64url');
