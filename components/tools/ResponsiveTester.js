'use client';

import { useCallback, useEffect, useState } from 'react';
import './responsive-tester.css';

const DEVICES = [
  { id: 'iphone-se', label: 'iPhone SE', w: 375, h: 667, icon: 'fa-mobile-screen' },
  { id: 'iphone-15', label: 'iPhone 15', w: 393, h: 852, icon: 'fa-mobile-screen' },
  { id: 'pixel-8', label: 'Pixel 8', w: 412, h: 915, icon: 'fa-mobile-screen' },
  { id: 'galaxy-s23', label: 'Galaxy S23', w: 360, h: 780, icon: 'fa-mobile-screen' },
  { id: 'ipad-mini', label: 'iPad Mini', w: 768, h: 1024, icon: 'fa-tablet-screen-button' },
  { id: 'ipad-air', label: 'iPad Air', w: 820, h: 1180, icon: 'fa-tablet-screen-button' },
  { id: 'laptop', label: 'Laptop', w: 1366, h: 768, icon: 'fa-laptop' },
  { id: 'desktop', label: 'Desktop', w: 1920, h: 1080, icon: 'fa-desktop' },
];
const DEFAULT_SELECTED = ['iphone-15', 'ipad-mini', 'laptop'];
const ZOOMS = [
  { id: 'fit', label: 'Fit height' },
  { id: '0.5', label: '50%' },
  { id: '0.75', label: '75%' },
  { id: '1', label: '100%' },
];
const STORE_KEY = 'mytrack.responsiveTester';
const MIN_SIDE = 200;
const MAX_SIDE = 3840;

async function api(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

// Accepts "example.com" as well as full URLs; only http(s) is allowed.
function normalizeUrl(raw) {
  const v = raw.trim();
  if (!v) throw new Error('Enter a URL to preview.');
  const withScheme = /^[a-z][a-z\d+.-]*:\/\/|^(file|data|javascript|mailto|about|blob):/i.test(v) ? v : `https://${v}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That doesn’t look like a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https pages can be previewed.');
  if (!url.hostname || /\s/.test(v)) throw new Error('That doesn’t look like a web address.');
  return url.href;
}

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}
function saveStore(value) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {}
}
const validCustom = (c) =>
  c && typeof c.id === 'string' && Number.isInteger(c.w) && Number.isInteger(c.h) &&
  c.w >= MIN_SIDE && c.w <= MAX_SIDE && c.h >= MIN_SIDE && c.h <= MAX_SIDE;

function Frame({ device, url, landscape, scale, reloadKey, onRotate, onReload }) {
  const w = landscape ? device.h : device.w;
  const h = landscape ? device.w : device.h;
  return (
    <figure className="rt-frame">
      <figcaption className="rt-frame-head" style={{ width: Math.max(w * scale, 190) }}>
        <div className="rt-frame-title">
          <i className={`fa-solid ${device.icon}`} aria-hidden="true" />
          <strong>{device.label}</strong>
          <span className="tool-mono">{w}×{h}</span>
        </div>
        <div className="rt-frame-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRotate} title={landscape ? 'Portrait' : 'Landscape'} aria-label={`Rotate ${device.label} to ${landscape ? 'portrait' : 'landscape'}`}>
            <i className="fa-solid fa-rotate" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReload} title="Reload" aria-label={`Reload ${device.label}`}>
            <i className="fa-solid fa-arrow-rotate-right" aria-hidden="true" />
          </button>
        </div>
      </figcaption>
      <div className="rt-screen" style={{ width: w * scale, height: h * scale }}>
        <iframe
          key={reloadKey}
          src={url}
          title={`${device.label} preview (${w}×${h})`}
          width={w}
          height={h}
          style={{ width: w, height: h, transform: `scale(${scale})` }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>
    </figure>
  );
}

export default function ResponsiveTester() {
  const [input, setInput] = useState('');
  const [url, setUrl] = useState(null); // the URL the frames show
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [forceFrames, setForceFrames] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [custom, setCustom] = useState([]);
  const [zoom, setZoom] = useState('fit');
  const [landscape, setLandscape] = useState({});
  const [reloads, setReloads] = useState({});
  const [reloadAll, setReloadAll] = useState(0);
  const [draft, setDraft] = useState({ label: '', w: '', h: '' });
  const [draftError, setDraftError] = useState('');
  const [fitHeight, setFitHeight] = useState(600);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const s = loadStore();
    if (s) {
      const customs = Array.isArray(s.custom) ? s.custom.filter(validCustom).slice(0, 20) : [];
      setCustom(customs);
      const known = new Set([...DEVICES.map((d) => d.id), ...customs.map((c) => c.id)]);
      if (Array.isArray(s.selected)) setSelected(s.selected.filter((id) => known.has(id)));
      if (ZOOMS.some((z) => z.id === s.zoom)) setZoom(s.zoom);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveStore({ selected, custom, zoom });
  }, [loaded, selected, custom, zoom]);

  // Frames fit a viewport's height (minus the app's top bar and the frame
  // labels), so the whole row is visible once the canvas is scrolled to.
  const measure = useCallback(() => {
    setFitHeight(Math.max(260, window.innerHeight - 170));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const allDevices = [...DEVICES, ...custom.map((c) => ({ ...c, icon: 'fa-crop-simple', custom: true }))];
  const active = allDevices.filter((d) => selected.includes(d.id));
  const tallest = Math.max(1, ...active.map((d) => (landscape[d.id] ? d.w : d.h)));
  const scale = zoom === 'fit' ? Math.min(1, fitHeight / tallest) : Number(zoom);

  async function load(e) {
    e?.preventDefault();
    setError('');
    let target;
    try {
      target = normalizeUrl(input);
    } catch (err) {
      setError(err.message);
      return;
    }
    setInput(target);
    setChecking(true);
    setForceFrames(false);
    setCheck(null);
    setUrl(null);
    try {
      const result = await api('/api/tools/responsive-tester', { url: target });
      setCheck(result);
      setUrl(target);
      setReloadAll((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  const toggleDevice = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function addCustom(e) {
    e.preventDefault();
    const w = Number.parseInt(draft.w, 10);
    const h = Number.parseInt(draft.h, 10);
    if (!(w >= MIN_SIDE && w <= MAX_SIDE && h >= MIN_SIDE && h <= MAX_SIDE)) {
      setDraftError(`Width and height must be between ${MIN_SIDE} and ${MAX_SIDE} px.`);
      return;
    }
    if (custom.length >= 20) {
      setDraftError('You can keep up to 20 custom sizes.');
      return;
    }
    const id = `custom-${Date.now().toString(36)}`;
    const label = draft.label.trim().slice(0, 30) || 'Custom';
    setCustom((prev) => [...prev, { id, label, w, h }]);
    setSelected((prev) => [...prev, id]);
    setDraft({ label: '', w: '', h: '' });
    setDraftError('');
  }
  const removeCustom = (id) => {
    setCustom((prev) => prev.filter((c) => c.id !== id));
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  let host = '';
  try {
    host = url ? new URL(url).host : '';
  } catch {}
  const refused = check?.checked && !check.allowed && !forceFrames;
  const mixed = url && typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http:');

  return (
    <div className="rt">
      <form className="tool-panel rt-top" onSubmit={load}>
        <div className="rt-url-row">
          <div className="rt-url">
            <label className="field-label" htmlFor="rt-url">Page URL</label>
            <input
              id="rt-url"
              className="input"
              type="text"
              inputMode="url"
              placeholder="example.com or http://localhost:5173"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={checking || !input.trim()}>
            <i className={`fa-solid ${checking ? 'fa-spinner fa-spin' : 'fa-play'}`} aria-hidden="true" /> {checking ? 'Checking…' : 'Preview'}
          </button>
        </div>

        <fieldset className="rt-devices">
          <legend className="field-label">Devices</legend>
          <div className="rt-device-list">
            {allDevices.map((d) => (
              <span key={d.id} className={`rt-device${selected.includes(d.id) ? ' on' : ''}`}>
                <label>
                  <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleDevice(d.id)} />
                  <i className={`fa-solid ${d.icon}`} aria-hidden="true" />
                  {d.label} <span className="tool-mono">{d.w}×{d.h}</span>
                </label>
                {d.custom && (
                  <button type="button" className="rt-device-remove" onClick={() => removeCustom(d.id)} aria-label={`Remove ${d.label} ${d.w}×${d.h}`} title="Remove">
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </fieldset>

        <div className="rt-custom" role="group" aria-label="Add a custom size">
          <input className="input" type="text" placeholder="Name (optional)" aria-label="Custom size name" value={draft.label} maxLength={30} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} placeholder="Width" aria-label="Custom width in pixels" value={draft.w} onChange={(e) => setDraft({ ...draft, w: e.target.value })} />
          <span className="tool-muted" aria-hidden="true">×</span>
          <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} placeholder="Height" aria-label="Custom height in pixels" value={draft.h} onChange={(e) => setDraft({ ...draft, h: e.target.value })} />
          <button type="button" className="btn btn-sm" onClick={addCustom}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add size
          </button>
          {draftError && <span className="rt-draft-error" role="alert">{draftError}</span>}
        </div>
      </form>

      {error && <div className="top-error" role="alert">{error}</div>}

      {url && (
        <div className="rt-bar">
          <div className="rt-status">
            {check?.checked && check.allowed && (
              <span className="tool-badge ok"><i className="fa-solid fa-check" aria-hidden="true" /> Can be framed</span>
            )}
            {check?.checked && !check.allowed && (
              <span className="tool-badge bad"><i className="fa-solid fa-ban" aria-hidden="true" /> Refuses framing</span>
            )}
            {check && !check.checked && (
              <span className="tool-badge warn"><i className="fa-solid fa-circle-info" aria-hidden="true" /> {check.message}</span>
            )}
            {check?.checked && check.redirected && (
              <span className="tool-muted">Redirects to <span className="tool-mono">{check.finalUrl}</span></span>
            )}
          </div>
          <div className="tool-row">
            <label className="rt-zoom">
              <span className="tool-muted">Zoom</span>
              <select className="input" value={zoom} onChange={(e) => setZoom(e.target.value)}>
                {ZOOMS.map((z) => <option key={z.id} value={z.id}>{z.id === 'fit' ? `${z.label} (${Math.round(scale * 100)}%)` : z.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-sm" onClick={() => setReloadAll((n) => n + 1)} disabled={refused || !active.length}>
              <i className="fa-solid fa-arrow-rotate-right" aria-hidden="true" /> Reload all
            </button>
            <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noopener noreferrer">
              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> Open
            </a>
          </div>
        </div>
      )}

      {mixed && (
        <div className="top-error" role="alert">This page is http:// and MyTrack is https:// — browsers block insecure pages inside secure ones, so the frames may stay blank.</div>
      )}

      {url && refused && (
        <div className="tool-panel rt-refused" role="status">
          <i className="fa-solid fa-shield-halved rt-refused-icon" aria-hidden="true" />
          <div>
            <h2>{host} doesn’t allow being shown inside other sites</h2>
            <p className="tool-muted">
              The site sends <span className="tool-mono">{check.reason}</span>, so browsers show an error instead of the page in a frame.
              Open it in a new tab and use your browser’s device toolbar (DevTools → Toggle device toolbar) instead.
            </p>
            <div className="tool-row">
              <a className="btn btn-primary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> Open in new tab
              </a>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForceFrames(true)}>Try frames anyway</button>
            </div>
          </div>
        </div>
      )}

      {url && !refused && (
        active.length === 0 ? (
          <div className="tool-panel tool-empty">Pick at least one device above.</div>
        ) : (
          <div className="rt-canvas" aria-label="Device previews">
            {active.map((d) => (
              <Frame
                key={d.id}
                device={d}
                url={url}
                scale={scale}
                landscape={!!landscape[d.id]}
                reloadKey={`${reloadAll}-${reloads[d.id] || 0}`}
                onRotate={() => setLandscape((p) => ({ ...p, [d.id]: !p[d.id] }))}
                onReload={() => setReloads((p) => ({ ...p, [d.id]: (p[d.id] || 0) + 1 }))}
              />
            ))}
          </div>
        )
      )}

      {!url && !error && (
        <div className="tool-panel tool-empty">
          Enter a URL and press Preview to see it at several screen sizes side by side.
        </div>
      )}

      <p className="tool-muted rt-hint">
        <i className="fa-solid fa-circle-info" aria-hidden="true" /> Frames use your browser’s own user agent, so sites that detect phones by user agent (rather than by screen width) may still show their desktop layout.
        Scrolling isn’t synced between frames — browsers don’t allow that for other sites.
      </p>
    </div>
  );
}
