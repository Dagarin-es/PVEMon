# PVEMon

🇬🇧 English · 🇪🇸 [Castellano](README.es.md)

**PVE nodes and Backups monitor.** A read-only PWA to watch Proxmox servers, their virtual machines, LXC and
Docker containers, disk health and backups, with notifications through push, email, Telegram, webhook and
Microsoft Teams. Stable version 1.5. The change history is in [`public/changelog.en.md`](public/changelog.en.md)
(also behind the **ChangeLog** button in the menu). The interface is available in **English and Spanish**
(Spanish by default; switch with the language selector on the login screen or in the menu).

📘 **User guide (PDF, 33 pages, with screenshots):** [⬇ English](https://github.com/Dagarin-es/PVEMon/raw/HEAD/docs/PVEMon-User-Guide.pdf) · [⬇ Castellano](https://github.com/Dagarin-es/PVEMon/raw/HEAD/docs/PVEMon-Guia-de-usuario.pdf)

> PVEMon **only reads**: it does not power off, power on, update, reboot or change anything on your servers. The only write outside itself is optional: moving already-processed backup emails to another folder.

## What it includes

| Area | Summary |
|---|---|
| **Status panel** | One card per node: status, temperature, uptime, machine data (with all its disks), disk health, backups and memory and disk rings. No “all OK” messages: the banner and the warning pill only appear when there are problems and lead to the first affected item. |
| **Nodes, VM, LXC, Docker** | Lists and cards with charts (1 h to 90 d), maintenance mode (1/4/24 h) and aliases. |
| **Disks** | SMART, wear, temperature, hours and ZFS pools every 30 min; “Failing disk”, “High SSD wear” and “Disk running very hot” alerts. |
| **Backups** | Proxmox backups (age and size), NAS backups by email (IMAP: Hyper Backup, Cobian…), file check on a network disk (NFS), storage space and a weekly summary. |
| **Alerts** | Editable rules, grouping by parent, snooze/reactivate, notification when they fire and when they recover. |
| **Notifications** | Push (Web Push), SMTP email, Telegram, generic JSON webhook and Teams (Workflows). |
| **Kiosk** | Canvas panels (gauges, summaries, text), kiosks with several panels and transitions (pixels or blur), kiosk selector, undo and arrow keys in the editor, uptime marker with a little face (“days without accidents” style) and swiping between panels on mobile. |
| **Users** | Administrator and monitor roles (sees only what is assigned), TOTP 2FA, photo, own password change, account lockout and audit log. |
| **Languages** | English and Spanish, per user. Screens, errors, alerts, emails, push and the weekly summary are translated. |
| **System** | Encrypted PVEMon backup (`.pvemonbak`), external heartbeat (Healthchecks, Uptime Kuma…), ChangeLog. |

## Installation

### Option A · Docker Hub image (recommended)

Image: [`dagarines/pvemon`](https://hub.docker.com/r/dagarines/pvemon) (amd64 and arm64). Create a folder with this `docker-compose.yml`:

```yaml
services:
  pvemon:
    image: dagarines/pvemon:latest   # or a fixed version, e.g. dagarines/pvemon:1.5.3
    container_name: pvemon
    restart: unless-stopped
    env_file: .env
    environment:
      DATA_DIR: /data
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

```bash
echo "SECRET_KEY=$(openssl rand -base64 32)" > .env     # KEEP IT: it encrypts the stored secrets
mkdir -p data
docker compose up -d
docker compose exec pvemon node dist/cli.js create-admin admin   # shows the password ONCE
curl localhost:3000/api/health
```

Update: `docker compose pull && docker compose up -d` (migrations are applied automatically; keep `data/` and `.env`).

### Option B · From the source code

```bash
git clone https://github.com/Dagarin-es/pvemon.git && cd pvemon
cp .env.example .env
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -base64 32)|" .env
mkdir -p data
docker compose up -d --build
docker compose exec pvemon node dist/cli.js create-admin admin   # shows the password ONCE
curl localhost:3000/api/health
```

- Recover access: `docker compose exec pvemon node dist/cli.js reset-password admin`.
- **Keep `SECRET_KEY`**: it encrypts the stored tokens and secrets; without it they cannot be decrypted.
- The container runs as **root** (needed so the NFS check can come from a reserved port).
- Update from source: `git pull` (or replace the folder, keeping `data/` and `.env`) and `docker compose up -d --build`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | (required) | 32 bytes in base64 to encrypt secrets at rest |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where it listens |
| `DATA_DIR` | `/data` (compose) | Folder of `config.db` and `metrics.db` |
| `TZ` | `Europe/Madrid` | Time zone of the weekly summary |
| `TELEGRAM_API`, `PVEMON_LAN_PORT` | api.telegram.org, `8006` | Advanced/testing |

### Approximate resources

CPU: 1 core. RAM: ~180 MB idle (reserve 512 MB). Disk: image ~400 MB + data (metrics history, a few tens of MB
after months with a couple of nodes). Network: outbound to nodes (8006), Docker (2375), SMTP/IMAP, Telegram,
push services, webhooks and NFS; inbound on port 3000.

### Nginx Proxy Manager

Proxy Host: `http`, the host IP, port `3000`, Websockets and Block Common Exploits on; SSL with Let's Encrypt,
Force SSL and HTTP/2. **Close port 3000 to the rest of the network** (only NPM should reach it): PVEMon trusts
`X-Forwarded-*`. With HTTPS the session cookie is marked `Secure` and HSTS is enabled. Push and installing as an
app require HTTPS.

## Adding a Proxmox server

1. In Proxmox create a user and an **API token without privilege separation** with the **PVEAuditor** role
   (read-only; it includes what is needed to read disks and SMART).
2. In PVEMon: **Menu → Nodes → Add a node or search the network** (name, address, Token ID and secret).
3. Confirm the **certificate fingerprint** (like SSH). If the certificate changes, PVEMon stops connecting.

PVEMon also searches private networks for Proxmox (port 8006) every 30 minutes and offers them to be added.
Each node is queried every 30 s; history is always stored (48 h in detail, 30 d at 5 min, 180 d hourly).

### Optional SSH access (read-only)

By pasting the “Set up SSH access” block once (node card → Connection and maintenance), PVEMon reads the CPU
temperature and checks pending updates instantly. The key is restricted (`restrict` + fixed command) to a
script with three read-only commands: `check`, `temp` and `version`. Without it, the Proxmox API is used.
“Remove SSH access” gives the block to remove it from the node and forgets the access in PVEMon.

## Docker on the machines

PVEMon reads containers through **docker-socket-proxy** (read-only), on each VM or LXC with Docker:

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1          # the only permission needed
    ports:
      - "THIS_MACHINE_IP:2375:2375"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Restrict port 2375 to PVEMon's IP with the firewall: anyone who can reach it can read the containers' data,
including their environment variables. New containers appear as not monitored.

## Backups

- **Proxmox**: age limit per node (days and hours) in Settings → PVE backups; the size is read from the backup task log.
- **By email (NAS, Cobian…)**: IMAP mailbox in Settings → Other backups, with an inbox folder and a processed folder (optionally pvemon marks as read and moves the emails already incorporated; it never deletes); each source has its own maximum age and everything can be edited.
- **File on a network disk (NFS v3)**: server, exported folder and a specific file or the newest one, with maximum age and minimum size; checked every 5 min without mounting anything. The name accepts wildcards (`*`, `?`), e.g. `folder/backup_*.ics` checks the newest one matching the pattern.
- **Weekly summary** by email and/or Telegram, and a storage space alert (>90 %).
- **PVEMon backup**: Settings → System, a password-encrypted file (AES-256-GCM). Also include `data/` in your own backups.

## Notifications

- **Push**: each person turns it on in Customise → Notifications on this device (HTTPS and Internet access). On Android, install PVEMon as an app so the browser name does not show.
- **Email / Telegram**: Settings → Notifications, with a test button; secrets encrypted.
- **Webhook**: JSON with the alert; optional `X-Pvemon-Token` header. **Teams**: Workflows webhook.
- Who receives each notification: Settings → Users → Notifications (per device and channel).
- Each person receives emails and push in their own language; Telegram, webhook and Teams use the oldest administrator's language.

## Kiosk

Menu → Kiosks: create **panels** (＋ Item: gauges, summaries, text) and gather them into **kiosks** (a panel can be in several; with more than one they rotate by themselves with the order, seconds and transition you choose). The **Kiosk** button in the bar opens a menu to choose which one to open in full screen (and the kiosk's “⋯” menu lets you switch); with **★ Main** you mark the one opened by default and with **Use here** you assign it to each device.

In the panel editor: **Cmd/Ctrl + Z** undoes, **Cmd/Ctrl + Shift + Z** redoes, the **arrow keys** move the selection (with Shift, jumps of 5).

## Security

scrypt passwords, TOTP 2FA, `HttpOnly` + `SameSite=Strict` cookie (+`Secure` on HTTPS), 14-day session, per-IP attempt limit and account lockout, origin check, CSP and security headers, generic errors, tokens and keys encrypted with `SECRET_KEY`, pinned certificate fingerprint of each node, restricted SSH and audit log. To report a vulnerability see [SECURITY.md](SECURITY.md).

## Main API

All routes hang from `/api` and require a session except `/health` and `/auth/login`.

| Route | Access |
|---|---|
| `GET /health` · `POST /auth/login` | public (login: 5/min per IP) |
| `POST /auth/logout` · `/auth/password` · `/auth/2fa/*` · `PUT /auth/lang` · `GET /auth/me` | authenticated |
| `/users`, `/servers`, `/alert-rules`, `/settings/*` | administrator |
| `GET /tree` · `/overview` · `/disks` · `/alerts` | authenticated (a monitor only sees what is assigned) |
| `GET /elements/:id/metrics[/:key]?range=1h\|6h\|24h\|7d\|30d\|90d` · `/elements/:id/disks` | authenticated with permission |
| `/kiosks`, `/kiosk-groups`, `/kiosks-main` | each user, their own |

The browser sends `X-Lang: en` to get server texts (errors, alerts…) in English.

### Read-only API (`/api/v1`)

Meant for Home Assistant, the future Android app and scripts. One key per program is created in **Settings → System → Read-only API** (shown only once; only its hash is stored). It is sent as `Authorization: Bearer pvm_…` (or `X-Api-Key`). All routes are `GET`; a key is useless for the rest of `/api` and cannot change anything. Limit: 120 requests/min. Texts in this API stay in Spanish.

| Route | Content |
|---|---|
| `/api/v1/summary` | Counters and names of what is failing: nodes, machines, backups (total and per source), disks, updates and alerts |
| `/api/v1/nodes` | Per node: status, CPU, memory, disk, temperature, uptime, pending updates, disk summary |
| `/api/v1/guests` | Per VM/LXC: status, IP, guest agent status, CPU, memory, disk, uptime, network |
| `/api/v1/backups` (`?compact=1` for short lists) | Each backup PVEMon knows (Proxmox and email sources, monitored or not: see the `monitored` field): status, age, size, message; and backup storage usage. The summary only counts monitored ones |
| `/api/v1/disks` | Each disk: health, wear, temperature, hours and power cycles, sectors; and ZFS pools |
| `/api/v1/alerts` | Open alerts (snoozed ones are not listed) |

## Structure

```
src/
  server.ts      Fastify startup, headers and origin check
  cli.ts         create-admin / reset-password
  i18n.ts        languages (server side)
  auth/          passwords, sessions, 2FA, role guards, audit
  routes/        HTTP routes
  proxmox/       client (pinned fingerprint), collector, discovery, disks
  metrics/       catalogue and SQLite store with retention
  alerts/        rule engine and notifications (push, SMTP, Telegram, webhook, Teams)
  mail/          IMAP reading of backup notices (and, if enabled, moving processed ones)
  update/        read-only SSH access and update check
  db/schema.ts   configuration DB (Drizzle)
public/          frontend (index.html, i18n.js, kiosk.js, app.css, sw.js, changelog.md, changelog.en.md)
public/i18n/     English dictionaries: en.json (screens) and en-server.json (server)
docs/            user guide in PDF (English and Spanish)
drizzle/         migrations
tools/           i18n-check.mjs (checks that every text is translated)
```

## Development

`npm ci && npm run build && node dist/db/migrate.js && node dist/server.js` (Node ≥ 22).
When releasing a version: bump `VER` in `public/index.html`, `version` in `package.json`, the cache name in
`public/sw.js` and **add its entry to `public/changelog.md` and `public/changelog.en.md`**.

### Languages

The Spanish text is the key: in the front end write `T('Spanish text')` (with `{0}`, `{1}`… placeholders if it carries data) and on the server `tr()` / `tf()` (`src/i18n.ts`). The translation goes in `public/i18n/en.json` (screens) or `public/i18n/en-server.json` (server). A text without a translation is shown in Spanish. After touching texts, `npm run build && node tools/i18n-check.mjs` reports any that are missing.

## License and support

[MIT](LICENSE) © 2026 Dagarin. Provided **as is, without warranty or guaranteed support**: bugs and suggestions are discussed in [Issues](https://github.com/Dagarin-es/pvemon/issues) and handled when possible.
