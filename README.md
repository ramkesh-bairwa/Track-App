# MyTrack

A personal record-keeper: create a **track** for anything you want a log
of (credentials, links, a project's activity, reading notes — anything),
give it whatever columns you need by dragging predefined field types onto
it, then fill it in either straight into the table or through a
generated form.

Stack: Next.js 14 (App Router) + MySQL (raw SQL via `mysql2`, no ORM).

## 1. Install

```bash
npm install
```

## 2. Configure the database

Copy `.env.example` to `.env` and fill in your MySQL credentials:

```bash
cp .env.example .env
```

## 3. Create the schema

This creates the database (if missing) and all tables from `scripts/schema.sql`:

```bash
npm run seed
```

## 4. Run it

```bash
npm run dev
```

Open http://localhost:3000 — you'll land on **Login**. Use **Create one**
to register the first account.

## How it works

- **Tracks** are your top-level lists (shown in the sidebar and as cards
  on the dashboard).
- Each track has its own **columns**, built by dragging field types
  (Text, Link, Credential, Number, Date, Dropdown, Checkbox, …) onto the
  structure panel when creating a track, or with **+ Column** afterward.
- Inside a track you get a spreadsheet-style table:
  - Click any cell to edit it directly.
  - **+ Quick row** adds an empty row you can fill in cell by cell.
  - **+ Add entry** opens a form generated from the track's columns —
    useful when a row has a lot of fields.
- Data is stored per-track as JSON (one row per entry), so every track
  can have a completely different shape without any schema migration.

## Notes

- Credential-type fields are stored as plain text in the database (no
  encryption) — masked only in the UI. Treat the database itself as the
  secret store, and secure MySQL access accordingly if you put real
  passwords in it.
- Auth is a simple email/password + JWT session cookie, scoped to a
  single self-hosted user base (no email verification, no password reset
  — add those if you expose this beyond yourself).

## Deploy

No Docker. The app runs natively on the VPS under PM2 (process `track-app`,
port 3006) behind Nginx + HTTPS at https://my-track.glamofashion.com.

`next build` is too slow on the 1-CPU server, so we **build on the Mac** and
copy the result over SSH:

```bash
./deploy.sh              # build locally → rsync → pm2 restart (+ health check)
./deploy.sh --no-build   # deploy the existing .next without rebuilding
./deploy.sh --restart    # just restart the app on the server
```

The script needs the SSH key `~/.ssh/id_ed25519_mytrack_vps`. It never copies
`.env`, `node_modules/` or `.next/cache/`; dependencies are installed on the
server with `npm ci` only when `package-lock.json` changed, and the pdf.js /
tesseract assets are re-copied there (the server's npm skips postinstall).

Server first-time setup (once): clone into `/var/www/Track-App`, create `.env`
(DB on 127.0.0.1), `npm ci`, `node scripts/migrate.js`, start with
`pm2 start npm --name track-app -- start -- -p 3006`, and point Nginx at it.
