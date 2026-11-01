import { readFileSync } from 'node:fs';
export const VERSION = (() => { try { return (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version; } catch { return '?'; } })();
