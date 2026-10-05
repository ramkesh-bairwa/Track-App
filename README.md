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

## Deploy (Docker + Jenkins)

Files: `Dockerfile`, `docker-compose.yml`, `Jenkinsfile`, `deploy/remote-deploy.sh`.

The Jenkins job builds the image, smoke-tests it, streams it to the server
over SSH (`docker save | ssh docker load`, no registry needed) and starts it
with docker compose. If the new version doesn't pass its health check, the
previous one is started again and the build fails.

**Server (once)**

1. Install Docker with the compose plugin; create the deploy user and add it
   to the `docker` group.
2. MySQL/MariaDB on the server must accept connections from Docker: set
   `bind-address = 0.0.0.0` (or the docker bridge IP) and allow the DB user
   from `172.%`. In `.env` use `DB_HOST=host.docker.internal`.
3. Put Nginx/Caddy with HTTPS in front of `127.0.0.1:3000`.

**Jenkins (once)**

- Plugins: Pipeline, Git, Credentials Binding, SSH Agent. The agent needs Docker.
- Credentials: `mytrack-deploy-ssh` (SSH key for the server) and
  `mytrack-env` (secret file: your production `.env`, see `.env.example`).
- New Pipeline job → "Pipeline script from SCM" → this repo. Fill in
  `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_DIR` on the first run.

**Database schema**: tick `RUN_MIGRATIONS` to apply `scripts/schema.sql` before
starting. It's safe to re-run, but uses MariaDB syntax (`ADD COLUMN IF NOT
EXISTS`) and fails on MySQL.

**Manually** (no Jenkins):

```bash
docker build -t mytrack:latest .
docker compose up -d                                    # uses .env next to it
docker compose run --rm mytrack node scripts/migrate.js # schema, if needed
```

Downloads and tracker screenshots are kept in the `mytrack-data` volume.
