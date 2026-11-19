# MyTrack Desktop (macOS + Windows)

The MyTrack web app packaged as a desktop app. It has the same pages and
features, and keeps its own database **on the computer**, with no server
or XAMPP needed.

## How it works

When the app starts, it runs these three things on the computer:

1. **MariaDB.** The database runs from inside the app and listens only on
   `127.0.0.1`, with passwords it generates on first start.
   - macOS: MariaDB 10.4.28, copied from XAMPP (Intel; runs on Apple Silicon through Rosetta).
   - Windows: the official MariaDB 10.11.19.
2. **The MyTrack server.** This is the same Next.js app as the website, built as a standalone server.
3. **A window** showing the app, plus a screenshot tracker that works the same on both systems.

It stops all of them again when you quit.

All data lives in the app-data folder:

| | Folder |
|---|---|
| macOS | `~/Library/Application Support/MyTrack` |
| Windows | `%APPDATA%\MyTrack` |

Inside it:

- `database/` holds the MariaDB data and `mariadb.log`.
- `screenshots/` holds screenshots taken by the tracker.
- `data/` holds downloads and testing-feedback screenshots.
- `server/` is the unpacked app server, rebuilt on every app update.
- `config.json` holds the generated database passwords and session secret.
- `mytrack.env` holds settings you can edit (Google Drive and Pexels keys).
- `server.log` is the server log.

To start over from scratch, quit MyTrack and delete this folder.

**The first account you register becomes the admin.**

## Building

You need Node 20+ and, for the macOS build, XAMPP installed in `/Applications/XAMPP`.
To use another MariaDB install instead, set `MARIADB_MAC_DIR` to the folder that has `bin/` and `share/`.

```bash
cd desktop
npm install

npm run dist:mac    # → dist/MyTrack-1.0.0.dmg (+ .zip)
npm run dist:win    # → dist/MyTrack Setup 1.0.0.exe   (builds fine from a Mac)
npm run dist:all    # both
```

Each `dist:*` command:

1. builds the web app into `../.next-desktop`. It never touches `../.next`, so it's
   safe while `npm run dev` is running.
2. packs it as `build/server.tar.gz`.
3. puts MariaDB for that OS in `vendor/mariadb/<os>`.
4. builds the installer.

To bundle the Google Drive and Pexels keys from `../.env` into the installer, run
`node scripts/build-server.mjs --with-keys` first. Anyone you give that installer to
can read those keys.

To run from source without making an installer:

```bash
npm run build-server && npm run fetch-db && npm start
```

## Sync with the website

**Sync (web ⇄ desktop)** in the profile menu (admins only) is a two-way merge between this app and the website, or between any two MyTrack installs.

1. On the **other** app, open Sync → **Sync keys** → **Create key**, and copy the key. It's shown only once.
2. Here, enter the other app's address (for example `http://localhost:3000` or your domain) and the key.
   Click **Test connection**, then **⇄ Sync now**.

What happens on each sync:

- This app pulls the other side's changes, then pushes its own.
- Both end up with everything. When the same thing changed on both sides, the newer change wins.
- Deletes sync too.
- Users are matched by email.

Revoking a key stops syncing straight away. The first sync merges everything, and later syncs only send what changed.

## Things to know

- **Unsigned builds.** There's no Apple or Microsoft code-signing certificate configured.
  - macOS: the first time, right-click MyTrack → **Open** → Open.
  - Windows: in SmartScreen, click **More info → Run anyway**.
  - To sign, set `CSC_LINK` / `CSC_KEY_PASSWORD` (see electron-builder's docs).
- **Port.** The app uses `http://localhost:3000` if it's free, otherwise another free
  port. **Help → About MyTrack** shows the port in use.
- **Google Drive backup.** Add your OAuth keys in **File → Edit settings (mytrack.env)**
  and restart. In Google Cloud, register
  `http://localhost:<port>/api/auth/google/callback` (shown in About) as a redirect URI.
- **Screenshots.** Use the same on/off switch on the Screenshots page.
  - While screenshots are on, MyTrack keeps running in the tray after you close the
    window, and opens at login, so capturing continues after a restart.
  - macOS asks for Screen Recording permission the first time.
  - The desktop tracker captures whole screens. It doesn't record the active
    window's title.
- **The Code backup** zips the app's server files. The database backup works as usual.
- **If the app crashes,** the next start stops the database it left running.
