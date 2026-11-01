import type { FastifyBaseLogger } from 'fastify';

type L = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

/** Logger compartido: el servidor le pasa el de Fastify al arrancar; en pruebas sale por consola. */
export let log: L = { info: console.log, warn: console.warn, error: console.error } as unknown as L;
export const setLogger = (l: L): void => { log = l; };
