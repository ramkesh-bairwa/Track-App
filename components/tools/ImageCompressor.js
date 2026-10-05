'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './image-compressor.css';

const FORMATS = [
  ['keep', 'Keep original'],
  ['image/jpeg', 'JPEG'],
  ['image/webp', 'WebP'],
  ['image/png', 'PNG'],
];
const ENCODABLE = ['image/jpeg', 'image/png', 'image/webp'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LABEL = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/avif': 'AVIF', 'image/bmp': 'BMP', 'image/svg+xml': 'SVG' };

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const typeLabel = (t) => LABEL[t] || (t ? t.replace('image/', '').toUpperCase() : '?');
const nextTick = () => new Promise((r) => setTimeout(r, 0));
const posInt = (v) => {
  const n = Math.round(Number(v));
  return v !== '' && Number.isFinite(n) && n > 0 ? n : 0;
};

function outName(name, type, sameType) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name || 'image';
  const ext = sameType && dot > 0 ? name.slice(dot + 1) : EXT[type];
  return `${base}-min.${ext}`;
}

// Decode with EXIF orientation applied; fall back to <img> for formats
// createImageBitmap can't take from a Blob (SVG).
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) throw new Error('empty');
      return await createImageBitmap(img);
    } catch {
      throw new Error('This browser can’t read this image.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function compress(file, s) {
  const bmp = await decode(file);
  const { width: w, height: h } = bmp;
  const scale = Math.min(1, s.maxW ? s.maxW / w : 1, s.maxH ? s.maxH / h : 1);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const type = s.format === 'keep' ? (ENCODABLE.includes(file.type) ? file.type : 'image/png') : s.format;

  const off = typeof OffscreenCanvas !== 'undefined';
  const canvas = off ? new OffscreenCanvas(tw, th) : Object.assign(document.createElement('canvas'), { width: tw, height: th });
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    // JPEG has no alpha: paint transparent areas with the chosen colour, not black.
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, tw, th);
  bmp.close?.();

  const quality = s.quality / 100;
  const blob = off
    ? await canvas.convertToBlob({ type, quality })
    : await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed.'))), type, quality));
  // Browsers without a WebP encoder (Safari) quietly hand back PNG.
  const actual = blob.type || type;
  const same = actual === file.type;
  const kept = same && tw === w && th === h && blob.size >= file.size;
  return {
    blob,
    url: URL.createObjectURL(blob),
    size: blob.size,
    type: actual,
    wanted: type,
    w: tw,
    h: th,
    srcW: w,
    srcH: h,
    kept,
    name: outName(file.name, actual, same),
  };
}

function Compare({ item, onClose }) {
  const [pos, setPos] = useState(50);
  const [side, setSide] = useState(false);
  const panel = useRef(null);
  const dragging = useRef(false);
  const out = item.out;

  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Drag on the picture itself, not just the range input under it.
  const track = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))));
  };
  const newUrl = out.kept ? item.url : out.url;
  return (
    <div className="tool-panel" ref={panel}>
      <div className="ic-panel-head">
        <h2>Compare · <span className="ic-compare-name">{item.name}</span></h2>
        <div className="tool-row">
          <label className="checkbox-row ic-small">
            <input type="checkbox" checked={side} onChange={(e) => setSide(e.target.checked)} />
            <span>Side by side</span>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close compare view">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>
      {side ? (
        <div className="ic-side">
          <figure>
            <div className="ic-checker"><img src={item.url} alt="Original" /></div>
            <figcaption>Original · {bytes(item.size)} · {out.srcW}×{out.srcH}</figcaption>
          </figure>
          <figure>
            <div className="ic-checker"><img src={newUrl} alt="Compressed" /></div>
            <figcaption>Compressed · {bytes(out.kept ? item.size : out.size)} · {out.w}×{out.h}</figcaption>
          </figure>
        </div>
      ) : (
        <>
          <div
            className="ic-slider ic-checker"
            style={{ aspectRatio: `${out.srcW} / ${out.srcH}` }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              track(e);
            }}
            onPointerMove={(e) => dragging.current && track(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <img src={item.url} alt="Original" draggable={false} />
            <img src={newUrl} alt="Compressed" draggable={false} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
            <span className="ic-divider" style={{ left: `${pos}%` }} aria-hidden="true" />
            <span className="ic-tag left">Original · {bytes(item.size)}</span>
            <span className="ic-tag right">Compressed · {bytes(out.kept ? item.size : out.size)}</span>
          </div>
          <input
            className="ic-range"
            type="range"
            min="0"
            max="100"
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Compare position: left shows the original, right the compressed image"
          />
        </>
      )}
    </div>
  );
}

// Re-encodes images with canvas in the browser; nothing is uploaded.
export default function ImageCompressor() {
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState('keep');
  const [quality, setQuality] = useState(80);
  const [maxW, setMaxW] = useState('');
  const [maxH, setMaxH] = useState('');
  const [bg, setBg] = useState('#ffffff');
  const [over, setOver] = useState(false);
  const [compareId, setCompareId] = useState(null);
  const [error, setError] = useState('');

  const itemsRef = useRef([]);
  const target = useRef(null); // { key, settings } the queue is working towards
  const running = useRef(false);

  // Items are also mutated from the async queue, so keep the ref in step
  // synchronously instead of waiting for a render.
  const update = useCallback((fn) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const t = target.current;
        const next = t && itemsRef.current.find((i) => i.key !== t.key);
        if (!next) break;
        update((cur) => cur.map((x) => (x.id === next.id ? { ...x, working: true } : x)));
        let patch;
        try {
          patch = { out: await compress(next.file, t.settings), error: '' };
        } catch (err) {
          patch = { out: null, error: err.message || 'Couldn’t process this image.' };
        }
        const alive = itemsRef.current.some((x) => x.id === next.id);
        if (!alive) {
          if (patch.out) URL.revokeObjectURL(patch.out.url);
          continue;
        }
        update((cur) => cur.map((x) => {
          if (x.id !== next.id) return x;
          if (x.out) URL.revokeObjectURL(x.out.url);
          return { ...x, ...patch, key: t.key, working: false };
        }));
        await nextTick();
      }
    } finally {
      running.current = false;
    }
  }, [update]);

  const settings = useMemo(
    () => ({ format, quality: Number(quality), maxW: posInt(maxW), maxH: posInt(maxH), bg }),
    [format, quality, maxW, maxH, bg],
  );
  const settingsKey = JSON.stringify(settings);

  // Debounced re-run whenever the settings change.
  useEffect(() => {
    const first = !target.current;
    const t = setTimeout(() => {
      target.current = { key: settingsKey, settings };
      pump();
    }, first ? 0 : 350);
    return () => clearTimeout(t);
  }, [settingsKey, settings, pump]);

  useEffect(() => () => {
    target.current = null;
    itemsRef.current.forEach((i) => {
      URL.revokeObjectURL(i.url);
      if (i.out) URL.revokeObjectURL(i.out.url);
    });
  }, []);

  const addFiles = useCallback((files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) {
      if (files.length) setError('Those files aren’t images.');
      return;
    }
    setError(imgs.length < files.length ? `Skipped ${files.length - imgs.length} file(s) that aren’t images.` : '');
    const added = imgs.map((file) => ({
      id: uid(),
      file,
      name: file.name || `pasted-${Date.now()}.png`,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
      key: null,
      out: null,
      error: '',
      working: false,
    }));
    update((cur) => [...cur, ...added]);
    pump();
  }, [update, pump]);

  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  function remove(id) {
    if (compareId === id) setCompareId(null);
    update((cur) => cur.filter((x) => {
      if (x.id !== id) return true;
      URL.revokeObjectURL(x.url);
      if (x.out) URL.revokeObjectURL(x.out.url);
      return false;
    }));
  }

  function clearAll() {
    setCompareId(null);
    update((cur) => {
      cur.forEach((x) => {
        URL.revokeObjectURL(x.url);
        if (x.out) URL.revokeObjectURL(x.out.url);
      });
      return [];
    });
  }

  const download = (href, name) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const linkFor = (i) => (i.out.kept ? { href: i.url, name: i.name } : { href: i.out.url, name: i.out.name });

  async function downloadAll() {
    for (const i of itemsRef.current) {
      if (!i.out) continue;
      const { href, name } = linkFor(i);
      download(href, name);
      // Browsers drop rapid-fire downloads; space them out.
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  const done = items.filter((i) => i.out);
  const busy = items.some((i) => i.working || (target.current && i.key !== target.current.key && !i.error));
  const totalIn = done.reduce((s, i) => s + i.size, 0);
  const totalOut = done.reduce((s, i) => s + (i.out.kept ? i.size : i.out.size), 0);
  const saved = totalIn ? Math.floor((1 - totalOut / totalIn) * 100) : 0;
  const lossless = format === 'image/png' || (format === 'keep' && items.length > 0 && items.every((i) => !['image/jpeg', 'image/webp'].includes(i.type)));
  const bgUsed = format === 'image/jpeg';
  const compareItem = items.find((i) => i.id === compareId && i.out);

  return (
    <div className="tool-split ic-tool">
      <div className="tool-panel">
        <h2>Settings</h2>
        <div className="field-group">
          <label className="field-label" htmlFor="ic-format">Output format</label>
          <select id="ic-format" className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <p className="field-hint">
            {format === 'keep'
              ? 'JPEG, PNG and WebP stay as they are; other formats (GIF, BMP, SVG…) become PNG.'
              : format === 'image/webp'
                ? 'WebP is usually the smallest. Safari may not encode it — you’ll see PNG then.'
                : format === 'image/png'
                  ? 'PNG is lossless: it only shrinks by resizing, and photos get bigger.'
                  : 'Best for photos. Transparent areas are filled with the colour below.'}
          </p>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="ic-quality">Quality — {quality}%</label>
          <input
            id="ic-quality"
            className="ic-range"
            type="range"
            min="10"
            max="100"
            step="1"
            value={quality}
            disabled={lossless}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
          <p className="field-hint">{lossless ? 'Quality applies to JPEG and WebP only.' : '70–85% is a good balance for photos.'}</p>
        </div>
        <div className="field-group ic-2col">
          <div>
            <label className="field-label" htmlFor="ic-maxw">Max width (px)</label>
            <input id="ic-maxw" className="input" type="number" min="1" placeholder="Any" value={maxW} onChange={(e) => setMaxW(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="ic-maxh">Max height (px)</label>
            <input id="ic-maxh" className="input" type="number" min="1" placeholder="Any" value={maxH} onChange={(e) => setMaxH(e.target.value)} />
          </div>
        </div>
        <p className="field-hint ic-hint-top">Keeps the aspect ratio and never enlarges.</p>
        <div className="field-group">
          <label className="field-label" htmlFor="ic-bg">Background for transparency (JPEG)</label>
          <div className="ic-color">
            <input id="ic-bg" type="color" value={bg} onChange={(e) => setBg(e.target.value)} disabled={!bgUsed} />
            <span className="tool-mono">{bg}</span>
          </div>
        </div>
        <div className="ic-note">
          <i className="fa-solid fa-shield-halved" />
          <span>
            Metadata is always stripped: re-encoding through a canvas drops EXIF, GPS and camera data. Rotation from
            EXIF is applied to the pixels first, so photos stay upright. Nothing leaves your browser.
          </span>
        </div>
      </div>

      <div>
        {error && <div className="top-error" role="alert">{error}</div>}
        <div className="tool-panel">
          <label
            className={`tool-drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              addFiles([...e.dataTransfer.files]);
            }}
          >
            <i className="fa-solid fa-images ic-drop-icon" />
            <strong>Drop images here, click to choose, or paste</strong>
            <span className="tool-muted">JPEG, PNG, WebP, GIF, BMP, AVIF — as many as you like</span>
            <input
              type="file"
              accept="image/*"
              multiple
              aria-label="Choose images to compress"
              onChange={(e) => {
                addFiles([...e.target.files]);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {compareItem && <Compare key={compareItem.id} item={compareItem} onClose={() => setCompareId(null)} />}

        {items.length > 0 && (
          <div className="tool-panel">
            <div className="ic-panel-head">
              <h2>
                Images <span className="tool-muted">· {items.length}</span>
                {busy && <span className="tool-muted ic-working"> <i className="fa-solid fa-spinner fa-spin" /> working…</span>}
              </h2>
              <div className="tool-row">
                <button type="button" className="btn btn-primary btn-sm" onClick={downloadAll} disabled={!done.length}>
                  <i className="fa-solid fa-download" /> Download all
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>Clear</button>
              </div>
            </div>
            <ul className="ic-list">
              {items.map((i) => {
                const o = i.out;
                // Floor savings so a tiny file never claims −100%.
                const pct = o ? (o.size <= i.size ? Math.floor((1 - o.size / i.size) * 100) : -Math.ceil((o.size / i.size - 1) * 100)) : 0;
                return (
                  <li key={i.id} className={`ic-item${i.working ? ' working' : ''}`}>
                    <div className="ic-thumb ic-checker">
                      <img src={o && !o.kept ? o.url : i.url} alt="" loading="lazy" />
                    </div>
                    <div className="ic-info">
                      <span className="ic-name" title={i.name}>{i.name}</span>
                      {i.error ? (
                        <span className="tool-badge bad">{i.error}</span>
                      ) : !o ? (
                        <span className="tool-muted"><i className="fa-solid fa-spinner fa-spin" /> Compressing…</span>
                      ) : (
                        <>
                          <span className="ic-sizes">
                            <span className="tool-muted">{bytes(i.size)}</span>
                            <i className="fa-solid fa-arrow-right-long" />
                            <strong>{bytes(o.kept ? i.size : o.size)}</strong>
                            {o.kept ? (
                              <span className="tool-badge warn">bigger — kept original</span>
                            ) : pct >= 0 ? (
                              <span className="tool-badge ok">−{pct}%</span>
                            ) : (
                              <span className="tool-badge warn">+{-pct}% bigger</span>
                            )}
                          </span>
                          <span className="tool-muted ic-dims">
                            {typeLabel(i.type)} {o.srcW}×{o.srcH}
                            {' → '}
                            {typeLabel(o.kept ? i.type : o.type)} {o.w}×{o.h}
                            {o.type !== o.wanted && ' (this browser can’t encode ' + typeLabel(o.wanted) + ')'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="ic-actions">
                      {o && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompareId(i.id)} aria-label={`Compare ${i.name} before and after`}>
                            <i className="fa-solid fa-table-columns" /><span className="ic-btn-text"> Compare</span>
                          </button>
                          <a className="btn btn-sm" href={linkFor(i).href} download={linkFor(i).name} aria-label={`Download ${linkFor(i).name}`}>
                            <i className="fa-solid fa-download" /><span className="ic-btn-text"> Download</span>
                          </a>
                        </>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm ic-remove" onClick={() => remove(i.id)} aria-label={`Remove ${i.name}`}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {done.length > 0 && (
              <div className="ic-total">
                <span>Total ({done.length} of {items.length})</span>
                <span className="ic-sizes">
                  <span className="tool-muted">{bytes(totalIn)}</span>
                  <i className="fa-solid fa-arrow-right-long" />
                  <strong>{bytes(totalOut)}</strong>
                  <span className={`tool-badge ${saved > 0 ? 'ok' : ''}`}>{saved > 0 ? `saved ${saved}%` : 'no savings'}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
