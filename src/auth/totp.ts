import { createHmac, randomBytes } from 'node:crypto';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  let bits = '', out = '';
  for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

const decode = (s: string) => {
  let bits = '';
  for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

export function hotp(secret: string, counter: number): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode(secret)).update(b).digest();
  const o = h[19]! & 15;
  const n = (((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Devuelve el paso de tiempo que coincide (±1 = 30 s de margen) o null. `last` evita reutilizar un código. */
export function verifyTotp(secret: string, code: string, last = 0): number | null {
  const step = Math.floor(Date.now() / 30000);
  for (const s of [step - 1, step, step + 1]) {
    if (s > last && hotp(secret, s) === code) return s;
  }
  return null;
}
