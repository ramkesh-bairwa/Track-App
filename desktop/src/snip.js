// Native screenshots for the Screenshot tool (components/tools/ScreenshotTool.js),
// reached from the page through preload.js:
//   displays()                     → the connected screens
//   capture({ mode: 'screen', displayId })   one screen (default: the one under the mouse)
//   capture({ mode: 'all' })                 every screen, laid out as arranged
//   capture({ mode: 'area' })                a dimmed, frozen copy of every screen;
//                                            drag a box anywhere (click = whole screen)
//   capture({ mode: 'page', url })           a whole web page, top to bottom
// MyTrack's own window is hidden while the screens are captured. Results are
// PNG bytes plus where each image sits, so the page can stitch several screens.
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setupSnip({ isApp, getWin, log }) {
  const owned = new WeakSet(); // overlay / page windows' web contents
  let busy = false;

  const displayInfo = () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || (d.internal ? 'Built-in display' : `Display ${i + 1}`),
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      primary: d.id === primary,
      bounds: d.bounds,
    }));
  };

  function screenAllowed() {
    return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted';
  }

  // Every display at its full pixel size.
  async function grabDisplays() {
    const displays = screen.getAllDisplays();
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
    return displays
      .map((d, i) => {
        const src = sources.find((s) => s.display_id === String(d.id)) || (displays.length === 1 ? sources[0] : sources[i]);
        if (!src || src.thumbnail.isEmpty()) return null;
        const w = Math.round(d.size.width * d.scaleFactor);
        const h = Math.round(d.size.height * d.scaleFactor);
        const img = src.thumbnail.getSize().width === w ? src.thumbnail : src.thumbnail.resize({ width: w, height: h, quality: 'best' });
        return { display: d, img, sourceId: src.id };
      })
      .filter(Boolean);
  }

  // Hide MyTrack, wait for any delay, take the shots, bring MyTrack back.
  async function withWindowHidden(delaySec, fn) {
    const win = getWin();
    const wasVisible = win && win.isVisible() && !win.isMinimized();
    if (wasVisible) win.hide();
    try {
      await wait(Math.max(350, delaySec * 1000));
      return await fn();
    } finally {
      if (wasVisible && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    }
  }

  const asResult = (shots) => ({
    images: shots.map(({ display, img }) => ({
      png: img.toPNG(),
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      scaleFactor: display.scaleFactor,
    })),
  });

  // ---------- area: one overlay per screen ----------

  function pickArea(shots, rectOnly = false) {
    return new Promise((resolve) => {
      const overlays = [];
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        ipcMain.removeListener('mytrack:snip-pick', onPick);
        for (const o of overlays) if (!o.win.isDestroyed()) o.win.destroy();
        resolve(result);
      };
      function onPick(event, rect) {
        const o = overlays.find((x) => x.win.webContents === event.sender);
        if (!o) return;
        if (!rect) return finish({ canceled: true });
        const { img, display } = o.shot;
        const k = img.getSize().width / display.bounds.width;
        const r = rect.whole
          ? { x: 0, y: 0, width: img.getSize().width, height: img.getSize().height }
          : {
              x: Math.max(0, Math.round(rect.x * k)),
              y: Math.max(0, Math.round(rect.y * k)),
              width: Math.round(rect.width * k),
              height: Math.round(rect.height * k),
            };
        r.width = Math.min(r.width, img.getSize().width - r.x);
        r.height = Math.min(r.height, img.getSize().height - r.y);
        if (r.width < 2 || r.height < 2) return finish({ canceled: true });
        if (rectOnly) {
          // Screen recorder: which screen, and the box on it in screen points.
          return finish({
            sources: [sourceOf(o.shot)],
            crop: rect.whole ? null : { x: Math.round(r.x / k), y: Math.round(r.y / k), width: Math.round(r.width / k), height: Math.round(r.height / k) },
          });
        }
        const cut = img.crop(r);
        finish({
          images: [{ png: cut.toPNG(), x: 0, y: 0, width: Math.round(r.width / k), height: Math.round(r.height / k), scaleFactor: display.scaleFactor }],
        });
      }
      ipcMain.on('mytrack:snip-pick', onPick);

      for (const shot of shots) {
        const b = shot.display.bounds;
        const win = new BrowserWindow({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          frame: false,
          show: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: false,
          enableLargerThanScreen: true,
          backgroundColor: '#000000',
          webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'snip-preload.js') },
        });
        owned.add(win.webContents);
        overlays.push({ win, shot });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        if (process.platform === 'darwin') win.setSimpleFullScreen(true);
        win.loadFile(path.join(__dirname, 'snip-overlay.html'));
        win.webContents.once('did-finish-load', () => {
          win.webContents.send('mytrack:snip-image', `data:image/png;base64,${shot.img.toPNG().toString('base64')}`);
        });
        win.once('ready-to-show', () => {
          win.show();
          // Focus the screen the mouse is on, so Esc works straight away.
          const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
          if (under.id === shot.display.id) win.focus();
        });
        win.on('closed', () => finish({ canceled: true }));
      }
      // Never leave overlays stuck on screen.
      setTimeout(() => finish({ canceled: true }), 5 * 60 * 1000);
    });
  }

  const sourceOf = ({ display, sourceId }) => ({
    sourceId,
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
  });

  // ---------- whole web page ----------

  async function capturePage(rawUrl) {
    let url;
    try {
      url = new URL(/^[a-z][\w+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    } catch {
      return { error: 'That isn’t a valid web address.' };
    }
    if (!/^https?:$/.test(url.protocol)) return { error: 'Only http:// and https:// pages can be captured.' };

    const width = 1366;
    const win = new BrowserWindow({
      show: false,
      width,
      height: 900,
      paintWhenInitiallyHidden: true,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, partition: 'snip-page', offscreen: false },
    });
    owned.add(win.webContents);
    win.webContents.setAudioMuted(true);
    const dbg = win.webContents.debugger;
    try {
      await Promise.race([
        win.loadURL(url.href, { userAgent: win.webContents.getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*MyTrack\/\S+/, '') }),
        wait(30000).then(() => {
          throw new Error('The page took too long to load.');
        }),
      ]);
      dbg.attach('1.3');
      // Scroll through once so lazy images load, then back to the top.
      await win.webContents.executeJavaScript(`(async () => {
        const h = () => Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
        for (let y = 0; y < Math.min(h(), 20000); y += innerHeight * 0.8) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
        scrollTo(0, 0); await new Promise(r => setTimeout(r, 400));
      })()`);
      const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      const height = Math.min(16000, Math.ceil(size.height));
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await wait(500);
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
      return {
        images: [{ png: Buffer.from(shot.data, 'base64'), x: 0, y: 0, width, height, scaleFactor: 1 }],
        title: win.webContents.getTitle(),
        cut: size.height > 16000,
      };
    } catch (err) {
      return { error: err.message || 'Couldn’t capture that page.' };
    } finally {
      try {
        dbg.detach();
      } catch {}
      if (!win.isDestroyed()) win.destroy();
    }
  }

  // ---------- IPC ----------

  ipcMain.handle('mytrack:snip-displays', (event) => (isApp(event.senderFrame?.url || '') ? displayInfo() : []));

  ipcMain.handle('mytrack:snip-capture', async (event, opts = {}) => {
    if (!isApp(event.senderFrame?.url || '')) return { error: 'Not allowed.' };
    if (busy) return { error: 'A screenshot is already being taken.' };
    busy = true;
    try {
      const mode = opts.mode;
      const delay = Math.min(30, Math.max(0, Number(opts.delay) || 0));
      if (mode === 'page') return await capturePage(String(opts.url || ''));
      if (!screenAllowed()) {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
        return {
          error:
            'MyTrack isn’t allowed to capture the screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then restart MyTrack.',
        };
      }
      if (mode === 'area') {
        // MyTrack stays hidden until the box is drawn (or Esc).
        return await withWindowHidden(delay, async () => {
          const shots = await grabDisplays();
          return shots.length ? pickArea(shots) : { error: 'Couldn’t capture the screen.' };
        });
      }
      const shots = await withWindowHidden(delay, grabDisplays);
      if (!shots.length) return { error: 'Couldn’t capture the screen.' };
      if (mode === 'all') return asResult(shots);
      // single screen
      const wanted =
        opts.displayId && opts.displayId !== 'cursor'
          ? String(opts.displayId)
          : String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
      const one = shots.find((s) => String(s.display.id) === wanted) || shots[0];
      return asResult([one]);
    } catch (err) {
      log(`screenshot error: ${err.message}`);
      return { error: err.message || 'Couldn’t take the screenshot.' };
    } finally {
      busy = false;
    }
  });

  // Screen recorder: which screen(s) to record ({ mode: 'screen' | 'all' | 'area' }).
  // The page then records them with getUserMedia (chromeMediaSourceId).
  ipcMain.handle('mytrack:rec-sources', async (event, opts = {}) => {
    if (!isApp(event.senderFrame?.url || '')) return { error: 'Not allowed.' };
    if (busy) return { error: 'A screenshot is being taken.' };
    if (!screenAllowed()) {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
      return {
        error:
          'MyTrack isn’t allowed to record the screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then restart MyTrack.',
      };
    }
    busy = true;
    try {
      if (opts.mode === 'area') {
        return await withWindowHidden(0, async () => {
          const shots = await grabDisplays();
          return shots.length ? pickArea(shots, true) : { error: 'Couldn’t capture the screen.' };
        });
      }
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const list = displays
        .map((d, i) => {
          const src = sources.find((x) => x.display_id === String(d.id)) || (displays.length === 1 ? sources[0] : sources[i]);
          return src ? sourceOf({ display: d, sourceId: src.id }) : null;
        })
        .filter(Boolean);
      if (!list.length) return { error: 'Couldn’t find a screen to record.' };
      if (opts.mode === 'all') return { sources: list };
      const wanted =
        opts.displayId && opts.displayId !== 'cursor'
          ? String(opts.displayId)
          : String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
      const i = displays.findIndex((d) => String(d.id) === wanted);
      return { sources: [list[i] || list[0]] };
    } catch (err) {
      log(`recorder sources error: ${err.message}`);
      return { error: err.message || 'Couldn’t start recording.' };
    } finally {
      busy = false;
    }
  });

  return { owns: (contents) => owned.has(contents) };
}

module.exports = { setupSnip };
