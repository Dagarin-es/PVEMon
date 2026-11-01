/**
 * Conexión SSH de SOLO LECTURA con los Proxmox.
 * La clave de pvemon queda limitada en el servidor a un script con tres órdenes: check (qué paquetes hay pendientes,
 * sin instalar nada), temp (temperatura de la CPU) y version. No hay orden de actualizar, reiniciar ni escribir.
 */
import ssh2 from 'ssh2';

const { Client, utils } = ssh2;
import { getSetting, setSetting } from '../alerts/notify.js';
import { decrypt, encrypt } from '../crypto.js';

interface KeyStore { privEnc: string; pub: string }

/** Par de claves de pvemon (se crea la primera vez; la privada va cifrada en la BD) */
export function getKey(): { priv: string; pubLine: string } {
  let k = getSetting<KeyStore>('ssh.key');
  if (!k) {
    const kp = utils.generateKeyPairSync('ed25519');
    k = { privEnc: encrypt(kp.private), pub: `${kp.public.trim()} pvemon` };
    setSetting('ssh.key', k);
  }
  return { priv: decrypt(k.privEnc), pubLine: k.pub };
}

export interface Target { serverId: string; host: string; port: number }
interface Pin { fp: string; at: number }
const pinKey = (id: string) => `ssh.host.${id}`;
export const getPin = (serverId: string): Pin | null => getSetting<Pin>(pinKey(serverId));

const toSha256 = (hex: string) => `SHA256:${Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '')}`;

export class SshError extends Error {}

export interface ExecResult { code: number; out: string; fingerprint: string }

export function sshExec(t: Target, command: 'check' | 'temp' | 'version', onLine?: (l: string) => void, timeoutMs = 60_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let changed = false;
    let fp = '';
    let out = '';
    let buf = '';
    let done = false;
    const finish = (err: Error | null, r?: ExecResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { c.end(); } catch { /* ya cerrada */ }
      err ? reject(err) : resolve(r!);
    };
    const timer = setTimeout(() => finish(new SshError('Tiempo de espera agotado esperando al nodo por SSH')), timeoutMs);
    const push = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      out += s;
      buf += s;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    };

    c.on('ready', () => {
      if (!getPin(t.serverId)) setSetting(pinKey(t.serverId), { fp, at: Math.floor(Date.now() / 1000) }); // primera vez: se fija la huella
      c.exec(command, (err, stream) => {
        if (err) return finish(new SshError(err.message));
        stream.on('data', push).stderr.on('data', push);
        stream.on('close', (code: number | null) => { if (buf) onLine?.(buf); finish(null, { code: code ?? 0, out, fingerprint: fp }); });
      });
    });
    c.on('error', (e: Error & { level?: string; code?: string }) => {
      if (changed) return finish(new SshError('La huella SSH del nodo ha cambiado desde la primera conexión. Si has reinstalado el Proxmox, quita el nodo y vuelve a añadirlo; si no, no sigas: podría no ser tu servidor.'));
      if (e.level === 'client-authentication') return finish(new SshError('El nodo no acepta la clave de pvemon: ejecuta en él el bloque de preparación que se muestra en pantalla.'));
      if (e.code === 'ECONNREFUSED') return finish(new SshError('Conexión SSH rechazada (puerto 22): ¿está activo el SSH del nodo?'));
      if (e.code === 'ENOTFOUND' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT') return finish(new SshError('No se llega al nodo por SSH (' + e.code + ')'));
      finish(new SshError(e.message));
    });
    c.on('close', () => { if (!done) finish(new SshError(changed ? 'Huella SSH distinta' : 'La conexión SSH se cerró antes de terminar')); });

    c.connect({
      host: t.host, port: t.port, username: 'root', privateKey: getKey().priv,
      readyTimeout: 15_000, keepaliveInterval: 10_000, hostHash: 'sha256',
      hostVerifier: (hash: string) => {
        fp = toSha256(hash);
        const pin = getPin(t.serverId);
        if (pin && pin.fp !== fp) { changed = true; return false; }
        return true;
      },
    });
  });
}

/** Bloque que el administrador pega una vez en la consola del Proxmox */
export function setupScript(): string {
  const { pubLine } = getKey();
  const body = String.raw`#!/bin/sh
# pvemon-script v4 (solo lectura)
case "$SSH_ORIGINAL_COMMAND" in
  check)   apt-get update -qq >/dev/null 2>&1; apt-get -s dist-upgrade | grep '^Inst ' || true ;;
  version) echo "pvemon-script 4" ;;
  temp)    for d in /sys/class/hwmon/hwmon*; do case "$(cat $d/name 2>/dev/null)" in k10temp|coretemp) v=$(cat $d/temp1_input 2>/dev/null) && echo "CPU $((v/1000))" && break ;; esac; done ;;
  *) echo "Orden no permitida" >&2; exit 2 ;;
esac
`;
  return [
    "cat > /usr/local/bin/pvemon-update <<'EOF'",
    body.trimEnd(),
    'EOF',
    'chmod 755 /usr/local/bin/pvemon-update',
    'mkdir -p /root/.ssh',
    `grep -qF '${pubLine.split(' ')[1]}' /root/.ssh/authorized_keys 2>/dev/null || echo 'restrict,command="/usr/local/bin/pvemon-update" ${pubLine}' >> /root/.ssh/authorized_keys`,
  ].join('\n');
}

/** Bloque para quitar del nodo la clave de pvemon, el script y los restos de versiones anteriores (gancho de apt del aviso de suscripción) */
export function removeScript(): string {
  const { pubLine } = getKey();
  return [
    `sed -i '\\|${pubLine.split(' ')[1]}|d' /root/.ssh/authorized_keys`,
    'rm -f /usr/local/bin/pvemon-update /etc/apt/apt.conf.d/99pvemon-nag',
  ].join('\n');
}
