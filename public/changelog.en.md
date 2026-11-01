# PVEMon ChangeLog
History rebuilt from the first numbered version. Most recent first.

## 2.0.0-beta.9 · 01/11/2026
- The rules of the built-in Synology Hyper Backup format (Backup_local, external NAS…) can now be seen under “Other backup programs”, with a **Create editable copy** button that generates an equivalent custom format with every field editable. Custom formats are applied before the built-in one.
- Custom formats have a new field: “Ignore if the subject contains…” (for notices that are not a backup, such as integrity checks).

## 2.0.0-beta.8 · 01/11/2026
- New: **Duplicate** button for custom email formats (“Other backup programs”). It creates a copy with another name and opens the form with all its fields (subject, sender, text, good/bad words, source and task) so you can change what you need. Handy for similar formats or when an email's format changes.

## 2.0.0-beta.7 · 01/11/2026
- Editing a backup that arrives by email now shows all its fields: source, name and the deadline (days and hours) after which it warns if no successful backup arrives, with a “Use the source limit” button.
- Editing a file check shows its source and has a **Test** button to check the connection before saving.
- **Cancel** button also on the add-file-check form.

## 2.0.0-beta.6 · 01/11/2026
- Fixed: mail accounts (a code-ordering error in beta 4) and backups arriving by email (an old bug: the edit form broke) could not be edited. They can be edited again in PVEMon and BCKMon.
- New: **Duplicate** button for mail accounts (the copy is disabled and keeps the same password) and for file checks (same path and limits, different name). The edit form opens so you can adjust what you need. Backups arriving by email cannot be duplicated: they are created on their own with each email, and a copy with no emails of its own would always stay “no data”.

## 2.0.0-beta.5 · 01/11/2026
- Fixed: the BETA tag in the header no longer takes up width. It is now a small superscript attached to the name, so on mobile the menu and avatar no longer get misaligned (PVEMon and BCKMon).

## 2.0.0-beta.4 · 01/11/2026
- New: **several mail accounts**. In Settings › Backups you can add, edit, test and remove accounts; each one has its own folders (inbox, processed, excluded), its own mark-as-read option and its own switch. The account you already had becomes the first one automatically (the old setting is left untouched, in case you go back to 1.5.7). Excluded senders and custom formats apply to all of them.
- New: Settings › Backups is reorganised into three views: **By email** (accounts, backups arriving by email, excluded senders, emails that are not understood and custom formats), **By file** (NFS checks and the backups checked that way) and **By source** (each NAS or computer with all its backups).
- New: the sign-in screen shows the version (and BETA).
- Moving backups between applications: mail accounts are exported with their password (the file is encrypted) and, when imported, are left **disabled**, so PVEMon and BCKMon do not read and move the same emails at once. Files from beta 2 and 3 are still valid.

## 2.0.0-beta.3 · 01/11/2026
- Backups can now be moved **in both directions**: export from PVEMon and import in BCKMon, or export from BCKMon and import in PVEMon (Settings › System has both cards in both applications). Same file format (`.bckmonx`); it only adds what is missing.
- New `actualizar.sh` script to update both local images and containers from a zip in `/opt`.

## 2.0.0-beta.2 · 01/11/2026
- New: **Export to BCKMon** (PVEMon, Settings › System). Creates an encrypted file (`.bckmonx`) with only what BCKMon needs: backup sources, backups, IMAP mail, excluded senders, custom formats and file checks (NFS), with their history. It does not include Proxmox servers, Docker, users, kiosks or alerts.
- New: **Import from PVEMon** (BCKMon, Settings › System). It only adds what is missing and replaces nothing; mail is configured only if BCKMon has none yet. The mail password is re-encrypted with BCKMon's own `SECRET_KEY`.
- Fixed: BCKMon could keep showing the PVEMon icon if the browser had it cached at the same address (icons are cached for 30 days). BCKMon now requests its icons from its own address.

## 2.0.0-beta.1 · 01/11/2026
- **Beta version.** The header shows “BETA” while the version carries “-beta”. The stable one is still 1.5.7 (`dagarines/pvemon:1.5.7`); on Docker Hub `latest` does not point to the beta. How to go back: `docs/VOLVER-A-1.5.7.md`.
- **BCKMon is born**, a second application built from the same code and focused only on backups: you get it with `EDITION=bckmon` (image `dagarines/bckmon`). Different name, icon and colours (greens), Backups is the home screen, Settings reorganised (Backups, Backup alerts, Notifications, Users, System), no nodes, VMs, LXC, Docker, disks or updates, and the read-only API only offers backups and alerts. It does not connect to Proxmox or Docker, nor scan the network.
- PVEMon stays exactly the same (apart from the “BETA” badge). The database does not change: `data/` also works with 1.5.7.
- Internal: new `EDITION` variable (`pvemon` by default) and `/brand.js`, `/manifest.webmanifest` and icons for each edition.

## 1.5.7 · 01/11/2026
- New: a third folder in “Mailbox where the backup notifications arrive”: “Folder excluded emails are moved to”. Emails from excluded senders are moved there **without being marked as read**, so you can review them and decide whether they still need to be excluded. Leave it empty not to move them. It works even if “Mark as read and move” is off. The folder is created if it does not exist.
- Excluded emails no longer appear in the “not moved” notice when this folder is set.

## 1.5.6 · 01/11/2026
- Improved: the mailbox status line now says which emails in the inbox folder were not moved and why (format not recognised, type of email that PVEMon ignores, excluded sender, or the source “X” has not been added).

## 1.5.5 · 01/11/2026
- Fixed: with “Mark as read and move”, emails of a task set to “Stop monitoring” always stayed in the inbox folder. They are now moved too (the source is added and the email is recognised).
- New: after each check, the mailbox status line says how many emails in the inbox folder were not moved and why (“not moved: N (their source is not added or the email is not recognised)”). To get them moved, add their source under “Backup sources”.

## 1.5.4 · 01/11/2026
- Fixed: with “Mark as read and move” on, emails that PVEMon had already read in an earlier check (for example because you turned the option on later, or a previous attempt failed) were never marked or moved to the processed folder; only newly arrived ones were. They are now handled too.
- Improved: every field in Settings (mail, notifications, users, backups, API, kiosks…) now has a visible title above it that does not disappear once it is filled in. The example stays inside the field.

## 1.5.3 · 01/11/2026
- New on GitHub: forms to open Issues (bug and suggestion) in Spanish and English, asking for version and logs and warning not to paste keys or IPs. Nothing changes in the application.

## 1.5.2 · 01/11/2026
- Fixed: the read-only API (`/api/v1/backups`) left out backups that the Backups screen did show: those of unmonitored items and newly added tasks that did not have a status yet. It now lists every backup PVEMon knows, with a new `monitored` field, and a new task appears as “none” until its first evaluation.
- The summary (`/api/v1/summary`) and its “ok” still count only monitored backups, like the alerts.
- Home Assistant: if your sensor counts backups with `backups | length`, use `backups | selectattr('monitored') | list | length` to count only the watched ones.

## 1.5.1 · 01/11/2026
- Fixed: in the kiosk (view and editor), any tile of a node, VM, LXC, container or backup showed “T is not a function” instead of the tile. It was a 1.5.0 bug (a function parameter hid the translation function).
- Fixed: each user’s “My notifications” screen had the same naming problem and could not be opened.
- Fixed: in the weekly summary, the day selector appeared in Spanish in the English interface (lunes, martes…).
- Examples in the interface and in the changelogs now use generic data (email, IP and file name).
- User guide as a PDF, in Spanish and English, with new screenshots made with fictitious data; download it from the README.
- Internal: the browser cache is now `pvemon-v90`.

## 1.5.0 · 31/10/2026
- **PVEMon is now available in two languages: Spanish and English.** Spanish is the default. Change it with the **Español / English** selector on the login screen and in Menu → Language. Your choice is remembered in the browser and in your user, so on another device it appears in your language when you log in.
- Everything is translated: screens, help texts, kiosks and the panel editor, the ChangeLog, server errors and messages, alerts and their rules, emails, push notifications and the weekly summary. Each person receives notifications in their own language. Channels with no specific user (Telegram, webhook and Teams) use the language of the oldest administrator.
- Dates, times and decimals follow the chosen language (decimal comma in Spanish, decimal point in English).
- The read-only API (/api/v1) does not change: it stays in Spanish so nothing that already uses it breaks.
- Security: dependencies updated (`@fastify/static` 10.1.8 with `glob`/`minimatch` fixed): 0 vulnerabilities in production.
- Internal: the Spanish text is the dictionary key (public/i18n/en.json and en-server.json); a text with no translation is shown in Spanish. New per-user language column (automatic migration) and a tools/i18n-check.mjs tool to check that no text is left untranslated.

## 1.4.3 · 31/10/2026
- The **uptime marker** also appears on the **Nodes**, **VM** and **LXC** screens, on each row, between the name and the memory and storage/disk meters.
- On the main screen (Status), the marker is in each node's header, just to the left of the “POWERED ON” indicator.
- Light theme: the marker digits are no longer black; they are now light cards with the digit in the accent colour, matching the rest of the interface. The dark theme keeps the glowing-sign look.

## 1.4.2 · 31/10/2026
- New **uptime marker**, in the style of the “days without accidents” signs in factories: a counter of glowing digits with the **days without a reboot** (hours or minutes if it has been up for less than a day) and a little face whose mood changes with how long the server has been up.
- It appears on the card of each **node**, **VM** and **LXC**, next to the status, and on the cards of each server in Menu → Nodes (where it replaces the “Powered on for” data; hover over the marker to see the exact time).
- Moods: just booted (< 1 h, dizzy), eager to keep going (< 1 day, sad), getting into rhythm (< 3 days), all good (< 30 days, happy), rock solid (30-100 days, star eyes) and uptime legend (100+ days, with a crown). Powered off: resting face and counter off.
- Smooth animations that respect the system's “reduce motion” setting; works in light and dark themes and on mobile.

## 1.4.1 · 27/10/2026
- The **Kiosk** button now **opens a menu** under the button itself to choose which kiosk to open, instead of opening a selection screen. It lists kiosks first and then single panels, with ★ on the main one and the last used highlighted. It closes with Escape or by clicking outside.
- Inside the kiosk, the “⋯” menu includes “Switch kiosk” with the same list.

## 1.4.0 · 27/10/2026
- Kiosk panel editor: **Cmd/Ctrl + Z** undoes the last change (several times) and **Cmd/Ctrl + Shift + Z** (or Ctrl + Y) redoes it. It undoes moving, resizing, adding, removing, indicators, text and screen ratio. Inside a text field the browser's normal undo still applies.
- Panel editor: the **arrow keys** move the selected tile (or tiles) by half a point; with Shift, by 5.
- **Several kiosks**: what used to be “rotating groups” is now called **kiosks**. A kiosk gathers the panels you want (the same panel can be in several) and rotates between them. The **Kiosk** button above lets you **choose which one to open** (it remembers the last used); if there is only one, it opens it directly.
- The “Backups status” summary (and the backup warnings and summaries of the nodes) **no longer show machines that are not monitored**.

## 1.3.0 · 25/10/2026
- Machine cards: they now show the IP address (and the others if there are several) of each VM and LXC, next to cores, memory and disk.
- VM cards: they show the guest agent (qemu-guest-agent) status: installed and responding, enabled but not responding, or not enabled in Proxmox.
- Node card: it shows the address pvemon uses to connect to it (when the server has a single node).

## 1.2.2 · 25/10/2026
- Fixed: when editing a file check, “Invalid input: expected "nfs"” appeared and it was not saved.

## 1.2.1 · 25/10/2026
- Copying the API key also works when pvemon is opened over HTTP (no browser clipboard).
- Errors when saving an edit (tasks, formats, checks) are now shown inside the form.
- When saving formats or excluded senders, the mailbox re-read is done in the background so saving does not hang waiting.

## 1.2.0 · 25/10/2026
- Backup email: two new settings, “folder where the emails arrive” and “folder they are moved to”. With “Mark as read and move”, pvemon marks as read and moves the emails already incorporated (only from registered sources; it never deletes). It creates the processed folder if it does not exist. This way Home Assistant no longer has to take care of it.
- “Edit” button on sources (name), tasks (name; for file checks, all the data) and custom formats (all fields, including the source and task regular expressions).
- File checks: the name accepts wildcards (* and ?). For example “folder/backup_*.ics” checks the newest file matching the pattern, with the same age and size limits.
- Machines: pvemon stores the IP of each VM/LXC and whether the guest agent (qemu-guest-agent) is enabled and responding. They appear in /api/v1/guests (ip, ips, guestAgent).

## 1.1.0 · 25/10/2026
- New read-only API (/api/v1) for Home Assistant, the future Android app and scripts: summary, nodes, machines, backups, disks and alerts. No key can change anything.
- API keys in Settings → System: one per program, shown only once, with last-used date and a delete button.
- Disks: power cycles are now also stored (along with hours, temperature and wear).
- Pending updates: pvemon checks them on its own (at startup and every 6 h, read-only) so the data is there without pressing anything.

## 1.0.0 · 25/10/2026
- First stable version: the BETA label is removed.
- New subtitle “PVE nodes and Backups monitor” on the login screen, the bar and the manifest.
- File checks on a network disk: the “in development” SMB and FTP options are removed (NFS only).
- Dependencies updated (Fastify, Nodemailer, Mailparser and others): 0 vulnerabilities in production.
- README rewritten and tidied.

## 0.14.7 · 24/10/2026
- Status panel and node card: all the node's physical disks are identified (model, type, size and device), not only the system one, and “Disk health” lists each disk (and ZFS pool) with its status.

## 0.14.6 · 24/10/2026
- Push notifications: PVEMon's own small icon (white silhouette on transparent) in Android's status bar, instead of Edge's.

## 0.14.5 · 24/10/2026
- The “back” arrow is removed from the header on all screens.
- Mobile: Status, Backups and Kiosk fit on the first line next to the menu; warnings go on their own line below, more visible.
- Settings: if the tabs do not fit they wrap to a second line instead of scrolling.
- ChangeLog: small button on the same line as the version, before BETA.

## 0.14.4 · 24/10/2026
- Mobile: the header becomes two lines (brand, warnings and menu on top; Status, Backups and Kiosk below) and the menu only shows the photo.
- The status panel no longer shows “All good” or “All OK”: the banner and the warning only appear when there are problems.
- Kiosk: in a rotating group you move to the next or previous panel by swiping (also “Previous panel” in the ⋯ menu).

## 0.14.3 · 24/10/2026
- Fixed: the active user can now change their own password from Settings → Users (asks for the current and the new one).
- New ChangeLog button next to the version in the menu and copyright notice.

## 0.14.2 · 24/10/2026
- Pending-updates text aligned with its button, and each alert rule's checkbox aligned with its title.
- “Remove SSH access” leaves the node clean (key, script and old apt hook).

## 0.14.1 · 24/10/2026
- Fixed the internal error when pressing “Forget access”.
- Icons in the “Memory” and “Disk” titles of the status panel.

## 0.14.0 · 24/10/2026
- PVEMon only reads: updating/rebooting from the app and the subscription-warning fix are removed; it only warns about pending updates.
- Read-only SSH script v4 (check, temp, version), optional, and a “Remove SSH access” section.
- Disks card before “Connection and maintenance”.
- Status panel: new “Disk health” row and box titles with an icon and unified size.

## 0.13.0
- Disk monitoring: SMART, wear, temperature and ZFS every 30 minutes, with alerts.
- Notifications through generic webhook and Microsoft Teams.
- Snooze active alerts.
- Two-step verification (2FA) with an authenticator app.

## 0.12.1
- Kiosk: rotating panel groups with order, time and transition (pixel dissolve or blur).
- “Kiosk” button in the bar: opens in full screen the panel or group marked ★ Main.
- Text box, multiple selection with a box and custom sizes.
- Warnings lead to the first item with a problem.

## 0.11.2
- Kiosk: per-panel theme, summary tiles (systems and backups) and tighter MINI tiles.

## 0.11.1
- Kiosk: resize from the sides, MINI button, click a tile to open the item and preview.

## 0.11.0
- Kiosk mode: clean screens with node, VM, LXC, Docker and backup tiles, canvas editor, error band and one panel per device.

## 0.10.3
- Narrow-screen adjustments (Nodes list bars and menu button on mobile).

## 0.10.2
- PVEMon icon on the welcome screen.

## 0.10.1
- Default minimum size of 1 KB in file checks and icons per backup type.

## 0.10.0
- Check a file on a network disk (NFS) with a folder browser and “newest file”.

## 0.9.3
- Managing each node moves to its card (“Connection and maintenance”) and “Add node or search the network” button.

## 0.9.2
- Nodes as a list and node card with machine data and charts.

## 0.9.1
- VM and LXC cards; memory and disk rings with used and free.

## 0.9.0
- VM and LXC menus grouped by node and help for setting up the heartbeat.

## 0.8.0
- Encrypted PVEMon backup and restore.
- External heartbeat (Healthchecks, Uptime Kuma…).
- Maintenance mode of 1 h, 4 h or 24 h.
- Weekly backup summary and storage space control.

## 0.7.2
- Status and Backups buttons in the title bar.

## 0.7.1
- Size of Hyper Backup backups, storage diagnostics and Proxmox backup size from the task log.

## 0.7.0
- Backups screen with the status of all backups and Docker expandable per machine.

## 0.6.6
- Button to fix the “No valid subscription” warning (removed in 0.14.0).

## 0.6.5
- Fix for access from networks with a proxy, office or VPN.

## 0.6.4
- Security: headers, origin check, account lockout and request limits.

## 0.6.3
- Performance: response compression and cache for fonts and icons.

## 0.6.2
- Settings tabs with the same width.

## 0.6.1
- Dark mode with a dimmed gradient on buttons and help texts.

## 0.6.0
- Expandable Docker in the machine list.

## 0.5.x
- 0.5.0: numbered versions, Settings with tabs and Telegram notifications.
- 0.5.3: update with a progress bar (removed in 0.14.0).
- 0.5.4 and 0.5.5: “?” pop-up help.
- 0.5.6: icons and colour per item type.

## Before 0.5 (phases 1–26)
- Monitoring of nodes, VMs, LXC and Docker through the Proxmox API with a read-only token.
- Alerts with rules, email notifications and push notifications.
- Users with administrator and monitor roles, and per-item access.
- Proxmox backups and NAS backups by email (IMAP).
- Light and dark themes, profile photo, network search for nodes and Docker deployment.
- Everything becomes “Nodes”, without the cluster concept in the interface.
