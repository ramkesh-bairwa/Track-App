// MyTrack desktop app (macOS, Windows, Ubuntu).
//
// On start it runs, all on this computer:
//   1. the bundled MariaDB server — data in <userData>/database
//   2. the MyTrack web server (the same app as the website) on localhost
//   3. a window showing it, plus the screenshot tracker
// and stops them again on quit. <userData> is the OS's app-data folder:
//   macOS   ~/Library/Application Support/MyTrack
//   Windows %APPDATA%\MyTrack
//   Ubuntu  ~/.config/MyTrack
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, Menu, Tray, shell, dialog, session, desktopCapturer, nativeImage, systemPreferences, powerMonitor, ipcMain, screen } = require('electron');
const Config = require('./src/config');
const Database = require('./src/mariadb');
const AppServer = require('./src/server');
const settings = require('./src/settings');
const { Tracker, setOpenAtLogin } = require('./src/tracker');
const { setupSnip } = require('./src/snip');

app.setName('MyTrack');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  // Google refuses sign-in from embedded browsers it recognises, so present
  // a plain Chrome user agent (needed for "Connect Google Drive").
  app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|MyTrack|mytrack-desktop)\/\S+/g, '');

  // Opened by the system at sign-in (for the tracker / system photos): start
  // without a window. Windows/Linux pass --hidden; macOS reports it instead.
  const startHidden =
    process.argv.includes('--hidden') || (process.platform === 'darwin' && Boolean(app.getLoginItemSettings().wasOpenedAtLogin));
  let config;
  let db;
  let server;
  let tracker;
  let win = null;
  let splash = null;
  let tray = null;
  let appUrl = '';
  let keepRunning = false; // screenshots or system photos on → keep going without a window
  let screenshotsOn = false;
  let systemPhotosOn = false;
  const lastShotOf = {}; // kind → time of the last attempt
  let screenLocked = false;
  let lastUnlockAt = 0;
  let lastResumeAt = 0;
  let agentLinked = false; // signed in to a MyTrack server (Server connection)
  let agentEmail = '';
  // <userData>/main.log: what the background part did (system photos…),
  // since it runs without a window or a terminal.
  const fs = require('fs');
  function log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    try {
      const file = path.join(app.getPath('userData'), 'main.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, line);
    } catch {
      // logging must never break the app
    }
    console.log(line.trim());
  }
  // Secret for the app's own requests to its server (system photos); new
  // every launch, never stored.
  const localToken = crypto.randomBytes(24).toString('base64url');
  let quitting = false;
  let stopped = false;

  const userData = () => app.getPath('userData');
  const isApp = (url) => {
    try {
      return new URL(url).origin === new URL(appUrl).origin;
    } catch {
      return false;
    }
  };
  // Google's sign-in pages, for "Connect Google Drive" (returns to localhost).
  const isGoogleSignIn = (url) => {
    try {
      const host = new URL(url).hostname;
      return host === 'accounts.google.com' || host.endsWith('.accounts.google.com') || host === 'myaccount.google.com';
    } catch {
      return false;
    }
  };

  // ---------- splash ----------
  function showSplash() {
    splash = new BrowserWindow({
      width: 420,
      height: 220,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#12151a',
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#12151a;color:#e6e9ef;font:14px -apple-system,Segoe UI,Ubuntu,sans-serif">
      <div style="text-align:center"><div style="font-size:22px;font-weight:600;color:#35c2a6;margin-bottom:10px">MyTrack</div>
      <div id="m">Starting…</div><div style="margin-top:8px;color:#8b93a5;font-size:12px">The first start takes a little longer while the database is set up.</div></div></body></html>`)}`);
    splash.once('ready-to-show', () => splash?.show());
  }
  function setSplash(text) {
    splash?.webContents.executeJavaScript(`document.getElementById('m').textContent=${JSON.stringify(text)}`).catch(() => {});
  }
  function closeSplash() {
    splash?.close();
    splash = null;
  }

  // ---------- main window ----------
  // Never larger than the screen's usable area (below the menu bar, above
  // the Dock) and always fully on a connected screen.
  function clampToWorkArea(b) {
    const wa = screen.getDisplayMatching(b).workArea;
    const width = Math.min(b.width, wa.width);
    const height = Math.min(b.height, wa.height);
    return {
      width,
      height,
      x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width),
      y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height),
    };
  }

  function startBounds() {
    const saved = config?.get('windowBounds');
    if (saved && saved.width && saved.height) return { bounds: clampToWorkArea(saved), maximized: Boolean(config.get('windowMaximized')) };
    const wa = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1440, wa.width - 40);
    const height = Math.min(920, wa.height - 40);
    return { bounds: { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) }, maximized: false };
  }

  function fitToScreen(w) {
    if (!w || w.isDestroyed() || w.isMaximized() || w.isFullScreen() || w.isSimpleFullScreen()) return;
    const b = w.getBounds();
    const fixed = clampToWorkArea(b);
    if (fixed.x !== b.x || fixed.y !== b.y || fixed.width !== b.width || fixed.height !== b.height) w.setBounds(fixed);
  }

  let boundsTimer = null;
  let displayWatch = false;
  function rememberBounds() {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      config?.set('windowMaximized', win.isMaximized());
      if (!win.isMaximized()) config?.set('windowBounds', win.getNormalBounds());
    }, 500);
  }

  function toggleFillScreen() {
    const w = BrowserWindow.getFocusedWindow() || win;
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  }

  function createWindow() {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const start = startBounds();
    win = new BrowserWindow({
      ...start.bounds,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'MyTrack',
      backgroundColor: '#12151a',
      // macOS full screen hides the minimise / zoom buttons; the green button
      // fills the screen instead (View → Fill Screen, ⌃⌘F) and keeps them.
      fullscreenable: process.platform !== 'darwin',
      icon: path.join(__dirname, 'src', 'tray@2x.png'),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, preload: path.join(__dirname, 'src', 'preload.js') },
    });
    if (start.maximized) win.maximize();
    win.on('resize', rememberBounds);
    win.on('move', rememberBounds);
    win.on('show', () => fitToScreen(win));
    if (!displayWatch) {
      // A screen unplugged or its resolution changed: pull the window back on.
      displayWatch = true;
      screen.on('display-removed', () => fitToScreen(win));
      screen.on('display-metrics-changed', () => fitToScreen(win));
    }
    win.loadURL(`${appUrl}/dashboard`);
    win.once('ready-to-show', () => win.show());
    win.on('close', (e) => {
      // With screenshots on, closing the window keeps MyTrack running in the
      // tray / dock so capturing continues.
      if (!quitting && keepRunning && process.platform !== 'darwin') {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => (win = null));
  }

  // ---------- tray (only while screenshots are on) ----------
  function updateTray() {
    if (!keepRunning) {
      tray?.destroy();
      tray = null;
      return;
    }
    if (tray) return;
    const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'tray.png'));
    tray = new Tray(process.platform === 'darwin' ? icon.resize({ width: 18, height: 18 }) : icon);
    tray.setToolTip('MyTrack is running in the background');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open MyTrack', click: createWindow },
        { type: 'separator' },
        { label: screenshotsOn ? 'Screenshots are on (every 5 minutes)' : 'Watching for sign-in / unlock (system photos)', enabled: false },
        { type: 'separator' },
        { label: 'Quit MyTrack', click: () => app.quit() },
      ])
    );
    tray.on('click', createWindow);
  }

  // ---------- web contents rules ----------
  function setupSession() {
    const ses = session.defaultSession;
    const allowed = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']);
    ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(isApp(details.requestingUrl || wc.getURL()) && allowed.has(permission)));
    ses.setPermissionCheckHandler((wc, permission, origin) => isApp(origin) && allowed.has(permission));
    // Screen recorder tool: getDisplayMedia needs a source picked here.
    ses.setDisplayMediaRequestHandler(
      (request, cb) => {
        desktopCapturer
          .getSources({ types: ['screen', 'window'] })
          .then((sources) => cb(sources[0] ? { video: sources[0], audio: process.platform === 'win32' ? 'loopback' : undefined } : {}))
          .catch(() => cb({}));
      },
      { useSystemPicker: true }
    );
  }

  app.on('web-contents-created', (_e, contents) => {
    // In-app popups (previews, prints) open as app windows; web links open
    // in the normal browser.
    contents.setWindowOpenHandler(({ url }) => {
      // Pages opened only to be captured never open anything else.
      if (snip.owns(contents)) return { action: 'deny' };
      if (isApp(url) || url.startsWith('blob:') || url === 'about:blank') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true } } };
      }
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (snip.owns(contents)) return; // a captured web page may move around freely
      if (isApp(url) || isGoogleSignIn(url) || url.startsWith('data:')) return;
      e.preventDefault();
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    });
  });

  // ---------- menu ----------
  function buildMenu() {
    const isMac = process.platform === 'darwin';
    const about = () =>
      dialog.showMessageBox({
        type: 'info',
        title: 'About MyTrack',
        message: `MyTrack ${app.getVersion()}`,
        detail: [
          `Address: ${appUrl}`,
          `Data folder: ${userData()}`,
          `Database: MariaDB on 127.0.0.1:${db?.port}`,
          '',
          `Google Drive backup redirect URI:\n${appUrl}/api/auth/google/callback`,
        ].join('\n'),
      });
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'Open data folder', click: () => shell.openPath(userData()) },
          { label: 'Edit settings (mytrack.env)…', click: () => shell.openPath(settings.settingsFile(app)) },
          { label: 'Open in web browser', click: () => shell.openExternal(`${appUrl}/dashboard`) },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goBack() },
          { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goForward() },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          process.platform === 'darwin'
            ? { label: 'Fill Screen', accelerator: 'Ctrl+Cmd+F', click: toggleFillScreen }
            : { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'About MyTrack', click: about },
          { label: 'Open logs folder', click: () => shell.openPath(userData()) },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // ---------- system photos ----------
  // A camera photo when the computer is started / signed in to (MyTrack is
  // opened at sign-in), unlocked or woken. Taken in a hidden window on the
  // capture page, which records it as a system event.
  // macOS: photos come from the "MyTrack Camera" helper (see camera-helper/),
  // launched through LaunchServices so the camera permission is its own and
  // survives MyTrack updates. Elsewhere: a hidden window on the capture page.
  const cameraHelper = () =>
    app.isPackaged
      ? path.join(process.resourcesPath, 'camera-helper', 'MyTrack Camera.app')
      : path.join(__dirname, 'vendor', 'camera-helper', 'MyTrack Camera.app');

  function runCameraHelper(extraArgs, timeoutMs = 40000) {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('/usr/bin/open', ['-W', '-n', '-g', '-a', cameraHelper(), '--args', ...extraArgs], { timeout: timeoutMs }, (err) =>
        resolve(err ? err.message : null)
      );
    });
  }

  // One photo from the helper → { photo: data URL | null, status }. Runs are
  // queued: two at once would fight over the camera.
  let helperQueue = Promise.resolve();
  function helperCapture() {
    const run = helperQueue.then(async () => {
      const out = path.join(app.getPath('temp'), `mytrack-shot-${Date.now()}.jpg`);
      try {
        const failed = await runCameraHelper([out]);
        let status = '';
        try {
          status = fs.readFileSync(`${out}.status`, 'utf8').trim();
        } catch {
          status = failed ? `error:${failed}` : 'error:no status';
        }
        const photo = status === 'ok' && fs.existsSync(out) ? `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}` : null;
        return { photo, status };
      } finally {
        fs.rmSync(out, { force: true });
        fs.rmSync(`${out}.status`, { force: true });
      }
    });
    helperQueue = run.catch(() => {});
    return run;
  }

  // Screenshot tool: native screen / all screens / area / full web page.
  const snip = setupSnip({ isApp, getWin: () => win, log });

  // Pages ask for a photo (login, app opened, app lock) through preload.js.
  ipcMain.handle('mytrack:take-photo', async (event) => {
    if (process.platform !== 'darwin' || !isApp(event.senderFrame?.url || '')) return null;
    const r = await helperCapture().catch((err) => ({ photo: null, status: `error:${err.message}` }));
    log(`page photo: ${r.photo ? 'ok' : r.status}`);
    return r;
  });

  async function helperPhoto(kind) {
    try {
      const { photo, status } = await helperCapture();
      const res = await fetch(`http://127.0.0.1:${new URL(appUrl).port}/api/system-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mytrack-local': localToken },
        body: JSON.stringify({ kind, photo: photo || undefined }),
      });
      log(`system photo (${kind}) ${photo ? 'saved with photo' : `saved without photo (camera: ${status})`} · server ${res.status}`);
    } catch (err) {
      log(`system photo (${kind}) error: ${err.message}`);
    }
  }

  function captureSystemPhoto(kind) {
    if (!appUrl) return log(`system photo (${kind}) skipped: app not ready`);
    if (!systemPhotosOn) return log(`system photo (${kind}) skipped: switched off`);
    // Only the same kind is de-duplicated (a burst of unlock events) — an
    // unlock is never dropped because of a wake just before it.
    if (Date.now() - (lastShotOf[kind] || 0) < 10 * 1000) return log(`system photo (${kind}) skipped: one was just taken`);
    lastShotOf[kind] = Date.now();
    if (process.platform === 'darwin') {
      log(`system photo (${kind}) taking with the camera helper…`);
      helperPhoto(kind);
      return;
    }
    log(`system photo (${kind}) taking…`);
    const shot = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      log(`system photo (${kind}) ${result}`);
      if (!shot.isDestroyed()) shot.close();
    };
    // The capture page reports "done:<result>" in its title.
    shot.on('page-title-updated', (_e, title) => title.startsWith('done') && done(title.slice(5) || 'done'));
    setTimeout(() => done('timed out'), 40000);
    shot.loadURL(`${appUrl}/capture-photo?kind=${kind}#${localToken}`).catch((err) => done(`failed to load: ${err.message}`));
  }

  // ---------- server link (lib/agentClient.js) ----------
  let agentRunning = false;
  async function agentTick() {
    if (!appUrl || agentRunning) return;
    agentRunning = true;
    try {
      const res = await fetch(`http://127.0.0.1:${new URL(appUrl).port}/api/agent-local/tick`, {
        method: 'POST',
        headers: { 'x-mytrack-local': localToken },
      });
      const out = await res.json().catch(() => ({}));
      const was = agentLinked;
      agentLinked = Boolean(out.linked);
      if (was !== agentLinked) {
        log(`server link: ${agentLinked ? 'on' : 'off'}`);
        applyBackground();
      }
      if (out.email) agentEmail = out.email;
      if (!out.linked || out.busy) return;
      if (out.error) return log(`server sync: ${out.error}`);
      if (out.settings?.screenshotMinutes) tracker?.setIntervalMinutes(out.settings.screenshotMinutes);
      if (out.settings && typeof out.settings.systemPhotos === 'boolean') systemPhotosOn = out.settings.systemPhotos;
      agentEmail = out.email || agentEmail;
      for (const cmd of out.commands || []) await runCommand(cmd);
    } catch (err) {
      log(`server sync failed: ${err.message}`);
    } finally {
      agentRunning = false;
    }
  }

  async function runCommand(cmd) {
    log(`command from server: ${cmd}`);
    if (cmd === 'screenshot_now') {
      if (agentEmail) await tracker?.captureNow(agentEmail);
      setTimeout(agentTick, 2000); // upload it straight away
    } else if (cmd === 'sync_now') {
      setTimeout(agentTick, 500);
    } else if (cmd === 'lock') {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!isApp(w.webContents.getURL())) continue;
        w.webContents
          .executeJavaScript(`window.dispatchEvent(new CustomEvent('mytrack:app-lock-now', { detail: { locked: false } }))`)
          .catch(() => {});
      }
    } else if (cmd === 'sign_out') {
      await signOut('admin on the server');
      for (const w of BrowserWindow.getAllWindows()) {
        if (isApp(w.webContents.getURL())) w.loadURL(`${appUrl}/login`).catch(() => {});
      }
    }
  }

  async function refreshSystemPhotos() {
    try {
      // 127.0.0.1, not localhost: Node may try ::1 first, where the server
      // isn't listening.
      const res = await fetch(`http://127.0.0.1:${new URL(appUrl).port}/api/system-events/settings`, {
        headers: { 'x-mytrack-local': localToken },
      });
      if (res.ok) {
        const was = systemPhotosOn;
        systemPhotosOn = Boolean((await res.json()).enabled);
        if (was !== systemPhotosOn) console.log(`[MyTrack] system photos ${systemPhotosOn ? 'on' : 'off'}`);
      }
      else console.error('system photos setting:', res.status);
    } catch (err) {
      console.error('system photos setting:', err.message); // keep the last value
    }
    applyBackground();
  }

  // Keep running (tray, open at sign-in) while screenshots or system
  // photos need it.
  let loginItemApplied = null;
  function applyBackground() {
    // Linked to a server: keep running so it syncs and an admin can reach it.
    const need = screenshotsOn || systemPhotosOn || agentLinked;
    if (need !== loginItemApplied) {
      loginItemApplied = need;
      console.log(`[MyTrack] open at sign-in: ${need ? 'on' : 'off'}`);
      try {
        setOpenAtLogin(need);
      } catch (err) {
        console.error('open at login:', err);
      }
    }
    if (need === keepRunning) return;
    keepRunning = need;
    updateTray();
  }

  // ---------- start / stop ----------
  async function boot() {
    if (!startHidden) showSplash();
    try {
      config = new Config(app);
      db = new Database(app, config);
      setSplash('Starting the database…');
      await db.start();
      setSplash('Updating the database…');
      await db.migrate(app.isPackaged ? path.join(process.resourcesPath, 'schema.sql') : path.join(__dirname, 'build', 'schema.sql'));

      // Port 3000 first: it's the redirect URI Google Drive backup was set up with.
      const port = await Database.freePort(config.get('appPort') || 3000);
      config.set('appPort', port);
      appUrl = `http://localhost:${port}`;
      const screenshots = path.join(userData(), 'screenshots');
      const creds = db.credentials();

      setSplash('Starting MyTrack…');
      server = new AppServer(app);
      await server.start({
        port,
        env: {
          ...settings.load(app),
          DB_HOST: creds.host,
          DB_PORT: String(creds.port),
          DB_USER: creds.user,
          DB_PASSWORD: creds.password,
          DB_NAME: creds.database,
          JWT_SECRET: config.get('jwtSecret'),
          SCREENSHOT_DIR: screenshots,
          DOWNLOAD_ROOT: path.join(userData(), 'data', 'downloads'),
          GOOGLE_OAUTH_REDIRECT_URI: `${appUrl}/api/auth/google/callback`,
          MYTRACK_DESKTOP: '1',
          MYTRACK_LOCAL_TOKEN: localToken,
          MYTRACK_APP_VERSION: app.getVersion(),
        },
      });

      setupSession();
      await signOut('app start');
      buildMenu();
      tracker = new Tracker(screenshots, {
        onEnabledChange: (on) => {
          screenshotsOn = on;
          applyBackground();
        },
      });
      tracker.start();
      await refreshSystemPhotos();
      setInterval(refreshSystemPhotos, 30000);
      // Linked to a server: check in, sync and pick up commands every minute.
      setTimeout(agentTick, 5000);
      setInterval(agentTick, 60000);
      // Who signed in: a photo on every unlock. A wake alone is often the Mac
      // waking itself with nobody there (and the lock screen still up), so it
      // only counts when the Mac was woken without a lock screen and someone
      // is actually using it.
      powerMonitor.on('lock-screen', () => {
        screenLocked = true;
        log('screen locked');
      });
      powerMonitor.on('unlock-screen', () => {
        screenLocked = false;
        lastUnlockAt = Date.now();
        log('screen unlocked');
        setTimeout(() => captureSystemPhoto('unlock'), 1500);
      });
      powerMonitor.on('suspend', () => log('sleeping'));
      powerMonitor.on('resume', () => {
        lastResumeAt = Date.now();
        log('woke up');
        setTimeout(() => {
          const unlockedSince = lastUnlockAt >= lastResumeAt;
          const idle = powerMonitor.getSystemIdleTime();
          if (unlockedSince || screenLocked || idle > 20) return log(`wake: no photo (${unlockedSince ? 'unlock photo instead' : screenLocked ? 'still locked' : 'nobody using it'})`);
          captureSystemPhoto('wake');
        }, 25000);
      });
      // Opened by the system at sign-in → someone started / signed in to it.
      // Give the camera a moment after a fresh boot.
      if (startHidden) {
        log('opened at sign-in');
        setTimeout(() => captureSystemPhoto('system_start'), 8000);
      }
      if (!startHidden) createWindow();
      closeSplash();
      // macOS asks for the camera (security photos) — never waited on, so an
      // unanswered prompt can't hold up the window or the background work.
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('camera') === 'not-determined') {
        systemPreferences.askForMediaAccess('camera').catch(() => false);
      }
      // …and for the camera helper used for system photos, while someone is
      // here to answer (it only asks once, then remembers).
      if (process.platform === 'darwin' && !startHidden) {
        runCameraHelper(['--request-access'], 120000).then((err) => log(`camera helper permission check: ${err || 'done'}`));
      }
    } catch (err) {
      closeSplash();
      console.error(err);
      dialog.showErrorBox('MyTrack couldn’t start', `${err.message}\n\nLogs are in:\n${userData()}`);
      await shutdown();
      app.exit(1);
    }
  }

  // Sign out of MyTrack: drop the login cookie. Done when the app quits —
  // which is what happens when you log out of / restart / shut down the Mac —
  // and again on start, in case the last quit was cut short.
  async function signOut(why) {
    try {
      const ses = session.defaultSession;
      const cookies = await ses.cookies.get({ name: 'mytrack_session' });
      for (const c of cookies) {
        const host = (c.domain || 'localhost').replace(/^\./, '');
        await ses.cookies.remove(`http://${host}${c.path || '/'}`, c.name).catch(() => {});
      }
      await ses.cookies.flushStore();
      if (cookies.length) log(`signed out (${why})`);
    } catch (err) {
      log(`sign-out failed (${why}): ${err.message}`);
    }
  }

  async function shutdown() {
    if (stopped) return;
    stopped = true;
    await signOut('app quit');
    tracker?.stop();
    await server?.stop().catch(() => {});
    await db?.stop().catch(() => {});
  }

  app.on('second-instance', () => appUrl && createWindow());
  app.on('activate', () => appUrl && createWindow());
  app.on('window-all-closed', () => {
    // macOS keeps apps running without windows; elsewhere quit — unless
    // screenshots are on (then it stays in the tray).
    if (process.platform !== 'darwin' && !keepRunning) app.quit();
  });
  app.on('before-quit', (e) => {
    quitting = true;
    if (stopped) return;
    e.preventDefault();
    shutdown().finally(() => app.quit());
  });

  // Stopped by the system (logout, kill, Ctrl+C) → quit normally, which
  // shuts the database down cleanly.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit());
  // Last resort if the app exits any other way: MariaDB treats SIGTERM as a
  // normal shutdown, so it never stays running on its own.
  process.on('exit', () => {
    try {
      db?.proc?.kill('SIGTERM');
    } catch {
      // already gone
    }
  });

  app.whenReady().then(boot);
}
