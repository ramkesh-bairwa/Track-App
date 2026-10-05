'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLLAGE_LAYOUTS, CANVAS_PRESETS, BACKGROUNDS, backgroundCss } from '@/lib/collageLayouts';
import { DEFAULT_ADJUST, applyAdjustments, makeCanvas } from '@/lib/imageOps';
import { FILTER_LIBRARY, FONTS, filterSwatchStyle } from '@/lib/imageEffects';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import PexelsPicker, { loadPexelsImage } from '@/components/photo/PexelsPicker';

const PREVIEW_MAX = 1100;
const MAX_IMAGES = 30;
const CELL_FILTERS = FILTER_LIBRARY.filter((p) => ['Basic', 'Film', 'Black & white'].includes(p.group)).slice(0, 30);

let nextId = 1;

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} could not be opened.`));
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Pixel rectangles for every cell at a given output size.
function cellRects(layout, W, H, spacing, margin) {
  const unit = Math.min(W, H) / 1000;
  const m = margin * unit;
  const g = spacing * unit;
  const iw = W - m * 2;
  const ih = H - m * 2;
  return layout.cells.map((c) => {
    const left = c.x > 0.0001 ? g / 2 : 0;
    const top = c.y > 0.0001 ? g / 2 : 0;
    const right = c.x + c.w < 0.9999 ? g / 2 : 0;
    const bottom = c.y + c.h < 0.9999 ? g / 2 : 0;
    return {
      x: m + c.x * iw + left,
      y: m + c.y * ih + top,
      w: c.w * iw - left - right,
      h: c.h * ih - top - bottom,
    };
  });
}

export default function CollageMaker({ onEditInEditor, active = true }) {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const filtered = useRef(new Map()); // `${imageId}|${filterId}` → canvas
  const drag = useRef(null);

  const [images, setImages] = useState([]); // [{ id, img, name, credit }]
  const [slots, setSlots] = useState([]); // per cell: { imageId, panX, panY, zoom, filter }
  const [layoutId, setLayoutId] = useState(COLLAGE_LAYOUTS.find((l) => l.cells.length === 4).id);
  const [preset, setPreset] = useState('square');
  const [custom, setCustom] = useState({ w: 2000, h: 2000 });
  const [spacing, setSpacing] = useState(16);
  const [margin, setMargin] = useState(24);
  const [radius, setRadius] = useState(12);
  const [bg, setBg] = useState('white');
  const [bgCustom, setBgCustom] = useState('#ffffff');
  const [selected, setSelected] = useState(0);
  const [countFilter, setCountFilter] = useState('match');
  const [caption, setCaption] = useState({ text: '', font: 'IBM Plex Sans', color: '#ffffff', size: 7, position: 'bottom', band: true });
  const [pexels, setPexels] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [format, setFormat] = useState('image/jpeg');
  const [dragOver, setDragOver] = useState(false);

  const layout = COLLAGE_LAYOUTS.find((l) => l.id === layoutId) || COLLAGE_LAYOUTS[0];
  const size = preset === 'custom' ? custom : CANVAS_PRESETS.find((p) => p.id === preset);
  const W = Math.max(200, Math.min(6000, Number(size.w) || 2000));
  const H = Math.max(200, Math.min(6000, Number(size.h) || 2000));

  // Keep one slot per cell; new cells take the next unused photo.
  useEffect(() => {
    setSlots((prev) => {
      const next = layout.cells.map((_, i) => prev[i] || { imageId: null, panX: 0, panY: 0, zoom: 1, filter: 'none' });
      const used = new Set(next.map((s) => s.imageId).filter(Boolean));
      const free = images.filter((im) => !used.has(im.id));
      return next.map((s) => (s.imageId && images.some((im) => im.id === s.imageId) ? s : { ...s, imageId: free.shift()?.id || null, panX: 0, panY: 0, zoom: 1 }));
    });
    setSelected((s) => Math.min(s, layout.cells.length - 1));
  }, [layout, images]);

  const imageFor = useCallback(
    (slot) => {
      const im = images.find((x) => x.id === slot?.imageId);
      if (!im) return null;
      if (!slot.filter || slot.filter === 'none') return im.img;
      const key = `${im.id}|${slot.filter}`;
      if (!filtered.current.has(key)) {
        const p = FILTER_LIBRARY.find((x) => x.id === slot.filter);
        const sw = im.img.naturalWidth || im.img.width;
        const sh = im.img.naturalHeight || im.img.height;
        const k = Math.min(1, 2400 / Math.max(sw, sh));
        const c = makeCanvas(sw * k, sh * k);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im.img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        applyAdjustments(data, { ...DEFAULT_ADJUST, ...(p?.adjust || {}) });
        ctx.putImageData(data, 0, 0);
        filtered.current.set(key, c);
      }
      return filtered.current.get(key);
    },
    [images]
  );

  const draw = useCallback(
    (canvas, outW, outH, { showSelection = false } = {}) => {
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      const b = bg === 'custom' ? { css: bgCustom } : BACKGROUNDS.find((x) => x.id === bg);
      if (b?.stops) {
        const grad = ctx.createLinearGradient(0, 0, outW, outH);
        b.stops.forEach((c, i) => grad.addColorStop(i / (b.stops.length - 1), c));
        ctx.fillStyle = grad;
      } else ctx.fillStyle = b?.css || '#fff';
      ctx.fillRect(0, 0, outW, outH);

      const unit = Math.min(outW, outH) / 1000;
      const rects = cellRects(layout, outW, outH, spacing, margin);
      rects.forEach((r, i) => {
        const slot = slots[i];
        const src = imageFor(slot);
        ctx.save();
        roundRect(ctx, r.x, r.y, r.w, r.h, radius * unit);
        ctx.clip();
        if (src) {
          const iw = src.naturalWidth || src.width;
          const ih = src.naturalHeight || src.height;
          const rot = (((slot.rotate || 0) % 360) + 360) % 360;
          const swap = rot === 90 || rot === 270;
          // When rotated a quarter turn, the cell's effective width/height swap
          // for the "cover" fit, so the photo still fills the cell.
          const cw = swap ? r.h : r.w;
          const ch = swap ? r.w : r.h;
          // 'fit' shows the whole photo (contain); default 'fill' crops to fill.
          const base = slot.fit === 'fit' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
          const scale = base * (slot.zoom || 1);
          const dw = iw * scale;
          const dh = ih * scale;
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          if (rot) ctx.rotate((rot * Math.PI) / 180);
          // Only pan when the photo actually overflows the cell.
          const offX = ((slot.panX || 0) * Math.max(0, dw - cw)) / 2;
          const offY = ((slot.panY || 0) * Math.max(0, dh - ch)) / 2;
          ctx.drawImage(src, -dw / 2 + offX, -dh / 2 + offY, dw, dh);
        } else {
          ctx.fillStyle = 'rgba(128,128,128,0.18)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = 'rgba(128,128,128,0.8)';
          ctx.font = `${Math.max(12, 28 * unit)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`Photo ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2);
        }
        ctx.restore();
        if (showSelection && i === selected) {
          ctx.save();
          ctx.strokeStyle = '#35c2a6';
          ctx.lineWidth = Math.max(3, 5 * unit);
          roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, radius * unit);
          ctx.stroke();
          ctx.restore();
        }
      });

      if (caption.text.trim()) {
        const px = (caption.size / 100) * Math.min(outW, outH);
        ctx.font = `700 ${px}px "${caption.font}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const y = caption.position === 'top' ? px * 1.1 + margin * unit : caption.position === 'center' ? outH / 2 : outH - px * 1.1 - margin * unit;
        if (caption.band) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(0, y - px * 0.85, outW, px * 1.7);
        }
        ctx.fillStyle = caption.color;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = px * 0.15;
        ctx.fillText(caption.text, outW / 2, y, outW * 0.94);
      }
    },
    [layout, slots, spacing, margin, radius, bg, bgCustom, caption, selected, imageFor]
  );

  const previewScale = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, Math.round(W * previewScale), Math.round(H * previewScale), { showSelection: true });
  }, [draw, W, H, previewScale]);

  // ---------- adding photos ----------
  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return setError(`You can use up to ${MAX_IMAGES} photos.`);
    setBusy('Opening photos…');
    setError('');
    try {
      const loaded = [];
      for (const f of files.slice(0, room)) loaded.push({ id: nextId++, img: await fileToImage(f), name: f.name });
      setImages((prev) => [...prev, ...loaded]);
      // Pick a layout that fits the number of photos, if the current one is too small.
      const total = images.length + loaded.length;
      if (layout.cells.length < total) {
        const fit = COLLAGE_LAYOUTS.find((l) => l.cells.length === Math.min(total, 12)) || COLLAGE_LAYOUTS[COLLAGE_LAYOUTS.length - 1];
        setLayoutId(fit.id);
      }
      if (files.length > room) setError(`Only the first ${room} were added (${MAX_IMAGES} photos max).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function addPexels(photos) {
    setBusy(`Downloading ${photos.length} photo${photos.length === 1 ? '' : 's'} from Pexels…`);
    setError('');
    try {
      const loaded = await Promise.all(
        photos.slice(0, MAX_IMAGES - images.length).map(async (p) => ({ id: nextId++, img: await loadPexelsImage(p), name: `pexels-${p.id}`, credit: p.photographer }))
      );
      setImages((prev) => [...prev, ...loaded]);
      const total = images.length + loaded.length;
      if (layout.cells.length < total) {
        const fit = COLLAGE_LAYOUTS.find((l) => l.cells.length === Math.min(total, 12));
        if (fit) setLayoutId(fit.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (!active) return undefined;
    function onPaste(e) {
      const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (files.length) addFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  function removeImage(id) {
    setImages((prev) => prev.filter((im) => im.id !== id));
    setSlots((prev) => prev.map((s) => (s.imageId === id ? { ...s, imageId: null } : s)));
  }

  function setSlot(i, patch) {
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function assign(imageId) {
    // Putting a photo into the selected cell swaps it with wherever it was.
    setSlots((prev) => {
      const from = prev.findIndex((s) => s.imageId === imageId);
      return prev.map((s, j) => {
        if (j === selected) return { ...s, imageId, panX: 0, panY: 0, zoom: 1 };
        if (j === from) return { ...s, imageId: prev[selected]?.imageId || null, panX: 0, panY: 0, zoom: 1 };
        return s;
      });
    });
  }

  function shuffle() {
    setSlots((prev) => {
      const ids = prev.map((s) => s.imageId);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return prev.map((s, i) => ({ ...s, imageId: ids[i], panX: 0, panY: 0, zoom: 1 }));
    });
  }

  // ---------- pointer: select a cell, drag to reposition, drop to swap ----------
  function cellAt(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const rects = cellRects(layout, W, H, spacing, margin);
    return { index: rects.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h), rects, x, y };
  }

  function onDown(e) {
    const { index, rects } = cellAt(e);
    if (index < 0) return;
    setSelected(index);
    const slot = slots[index];
    if (!slot?.imageId) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const src = imageFor(slot);
    const r = rects[index];
    const iw = src.naturalWidth || src.width;
    const ih = src.naturalHeight || src.height;
    const scale = Math.max(r.w / iw, r.h / ih) * (slot.zoom || 1);
    drag.current = { index, startX: e.clientX, startY: e.clientY, panX: slot.panX, panY: slot.panY, overW: iw * scale - r.w, overH: ih * scale - r.h, moved: false };
  }

  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const k = W / rect.width;
    const dx = (e.clientX - d.startX) * k;
    const dy = (e.clientY - d.startY) * k;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    const panX = d.overW > 1 ? Math.max(-1, Math.min(1, d.panX + (dx * 2) / d.overW)) : 0;
    const panY = d.overH > 1 ? Math.max(-1, Math.min(1, d.panY + (dy * 2) / d.overH)) : 0;
    setSlot(d.index, { panX, panY });
  }

  function onUp(e) {
    const d = drag.current;
    drag.current = null;
    if (!d || !e.shiftKey) return;
    // Shift+drag onto another cell swaps the two photos.
    const { index } = cellAt(e);
    if (index >= 0 && index !== d.index) {
      setSlots((prev) => prev.map((s, j) => (j === d.index ? { ...prev[index], filter: s.filter } : j === index ? { ...prev[d.index], filter: s.filter } : s)));
      setSelected(index);
    }
  }

  function onWheel(e) {
    const { index } = cellAt(e);
    if (index < 0 || !slots[index]?.imageId) return;
    e.preventDefault();
    const z = Math.max(1, Math.min(4, (slots[index].zoom || 1) * (e.deltaY < 0 ? 1.08 : 0.93)));
    setSlot(index, { zoom: z });
  }

  // React's onWheel is passive (can't stop the page scrolling), so attach
  // the zoom listener ourselves and always call the latest handler.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const fn = (e) => wheelRef.current(e);
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

  // ---------- export ----------
  async function renderFull() {
    const c = makeCanvas(W, H);
    draw(c, W, H);
    return c;
  }

  async function download(kind) {
    if (!images.length) return setError('Add some photos first.');
    setBusy('Rendering collage…');
    setError('');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const c = await renderFull();
      const name = safeFilename(caption.text || 'collage', 'collage');
      if (kind === 'pdf') {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
        const img = await doc.embedJpg(await blob.arrayBuffer());
        const pageW = W >= H ? 842 : 595;
        const pageH = (pageW * H) / W;
        const page = doc.addPage([pageW, pageH]);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
        downloadBlob(new Blob([await doc.save()], { type: 'application/pdf' }), `${name}.pdf`);
      } else {
        const blob = await new Promise((r) => c.toBlob(r, format, 0.93));
        downloadBlob(blob, `${name}.${format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg'}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function editInEditor() {
    if (!images.length) return setError('Add some photos first.');
    setBusy('Opening in the photo editor…');
    await new Promise((r) => setTimeout(r, 30));
    const c = await renderFull();
    setBusy('');
    onEditInEditor?.(c, safeFilename(caption.text || 'collage', 'collage'));
  }

  const layoutsShown = useMemo(() => {
    if (countFilter === 'all') return COLLAGE_LAYOUTS;
    const n = countFilter === 'match' ? Math.max(1, Math.min(12, images.length || 4)) : Number(countFilter);
    const exact = COLLAGE_LAYOUTS.filter((l) => l.cells.length === n);
    return exact.length ? exact : COLLAGE_LAYOUTS;
  }, [countFilter, images.length]);

  const slot = slots[selected];
  const credits = [...new Set(images.map((im) => im.credit).filter(Boolean))];

  return (
    <div className="collage">
      <div className="photo-toolbar">
        <span className="task-muted" style={{ fontSize: 12.5 }}>
          {images.length} photo{images.length === 1 ? '' : 's'} · {layout.cells.length} cells · {W}×{H}px
        </span>
        <div className="photo-toolbar-actions">
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>＋ Add photos</button>
          <button type="button" className="btn btn-sm" onClick={() => setPexels(true)}><i className="fa-solid fa-camera-retro" /> Pexels</button>
          <button type="button" className="btn btn-sm" onClick={shuffle} disabled={images.length < 2}>🔀 Shuffle</button>
          <button type="button" className="btn btn-sm" onClick={editInEditor} disabled={!images.length || Boolean(busy)} title="Open the finished collage in the photo editor">✎ Edit in photo editor</button>
          <select className="input input-sm" value={format} onChange={(e) => setFormat(e.target.value)} style={{ width: 90 }} aria-label="Format">
            <option value="image/jpeg">JPG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WEBP</option>
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => download('image')} disabled={Boolean(busy)}>⬇ Download</button>
          <button type="button" className="btn btn-sm" onClick={() => download('pdf')} disabled={Boolean(busy)}><i className="fa-solid fa-file-pdf" /> PDF</button>
        </div>
      </div>
      {error && <div className="top-error">{error}</div>}

      <div className="photo-main">
        <div
          className={`photo-stage${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <canvas
            ref={canvasRef}
            className="photo-canvas collage-canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => (drag.current = null)}
          />
          {!images.length && (
            <button type="button" className="collage-empty" onClick={() => fileRef.current?.click()}>
              <i className="fa-solid fa-images" />
              <strong>Add photos to start your collage</strong>
              <span>Drop several photos here, click to choose, paste, or use Pexels</span>
            </button>
          )}
          {busy && (
            <div className="photo-busy">
              <span className="photo-spinner" />
              {busy}
            </div>
          )}
        </div>

        <aside className="photo-panel">
          <div className="photo-panel-body">
            <div className="photo-section-label" style={{ marginTop: 2 }}>Photos ({images.length}/{MAX_IMAGES})</div>
            <div className="collage-tray">
              {images.map((im) => {
                const where = slots.findIndex((s) => s.imageId === im.id);
                return (
                  <div key={im.id} className={`collage-thumb${where === selected ? ' active' : ''}`}>
                    <button type="button" onClick={() => assign(im.id)} title={`Put in cell ${selected + 1}`}>
                      <img src={im.img.src} alt="" />
                      {where >= 0 && <span className="collage-thumb-num">{where + 1}</span>}
                    </button>
                    <button type="button" className="collage-thumb-x" onClick={() => removeImage(im.id)} title="Remove">×</button>
                  </div>
                );
              })}
              <button type="button" className="collage-thumb add" onClick={() => fileRef.current?.click()} title="Add photos">＋</button>
            </div>
            <p className="field-hint">Click a cell, then a photo to put it there. Drag inside a cell to reposition, scroll to zoom, Shift+drag onto another cell to swap.</p>

            {slot?.imageId && (
              <>
                <div className="photo-section-label">Cell {selected + 1}</div>
                <div className="photo-btn-row" style={{ marginBottom: 4 }}>
                  <button type="button" className={`btn btn-sm${slot.fit !== 'fit' ? ' btn-primary' : ''}`} onClick={() => setSlot(selected, { fit: 'fill' })} title="Crop the photo to fill the cell">Fill</button>
                  <button type="button" className={`btn btn-sm${slot.fit === 'fit' ? ' btn-primary' : ''}`} onClick={() => setSlot(selected, { fit: 'fit', panX: 0, panY: 0 })} title="Show the whole photo inside the cell">Fit whole photo</button>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" style={{ marginBottom: 8 }} onClick={() => setSlots((prev) => prev.map((s) => ({ ...s, fit: slot.fit === 'fit' ? 'fit' : 'fill', ...(slot.fit === 'fit' ? { panX: 0, panY: 0 } : {}) })))}>
                  Apply “{slot.fit === 'fit' ? 'Fit whole photo' : 'Fill'}” to all cells
                </button>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Zoom</span><span className="photo-slider-value">{Math.round((slot.zoom || 1) * 100)}%</span></span>
                  <input type="range" min={100} max={400} value={Math.round((slot.zoom || 1) * 100)} onChange={(e) => setSlot(selected, { zoom: Number(e.target.value) / 100 })} />
                </label>
                <div className="collage-cell-filters">
                  {CELL_FILTERS.map((p) => (
                    <button key={p.id} type="button" className={slot.filter === p.id ? 'active' : ''} onClick={() => setSlot(selected, { filter: p.id })} title={p.label}>
                      <span className="photo-filter-swatch" style={filterSwatchStyle(p)} />
                      <small>{p.label}</small>
                    </button>
                  ))}
                </div>
                <div className="photo-btn-row" style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setSlot(selected, { rotate: (((slot.rotate || 0) + 90) % 360) })} title="Rotate this photo 90°">
                    <i className="fa-solid fa-rotate-right" /> Rotate{slot.rotate ? ` (${slot.rotate}°)` : ''}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setSlot(selected, { rotate: (((slot.rotate || 0) - 90 + 360) % 360) })} title="Rotate this photo −90°">
                    <i className="fa-solid fa-rotate-left" />
                  </button>
                </div>
                <div className="photo-btn-row" style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSlot(selected, { panX: 0, panY: 0, zoom: 1, rotate: 0 })}>Re-centre</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSlot(selected, { imageId: null })}>Empty cell</button>
                </div>
              </>
            )}

            <div className="photo-section-label">Layout ({layoutsShown.length})</div>
            <select className="input input-sm" value={countFilter} onChange={(e) => setCountFilter(e.target.value)} style={{ marginBottom: 8 }}>
              <option value="match">Fits my {images.length || 4} photos</option>
              <option value="all">All {COLLAGE_LAYOUTS.length} layouts</option>
              {[...new Set(COLLAGE_LAYOUTS.map((l) => l.cells.length))].map((n) => (
                <option key={n} value={n}>{n} photo{n === 1 ? '' : 's'}</option>
              ))}
            </select>
            <div className="collage-layouts">
              {layoutsShown.map((l) => (
                <button key={l.id} type="button" className={`collage-layout${l.id === layoutId ? ' active' : ''}`} onClick={() => setLayoutId(l.id)} title={l.label}>
                  {l.cells.map((c, i) => (
                    <span key={i} style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }} />
                  ))}
                </button>
              ))}
            </div>

            <div className="photo-section-label">Size</div>
            <select className="input input-sm" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {CANVAS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label} — {p.w}×{p.h}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {preset === 'custom' && (
              <div className="photo-resize" style={{ marginTop: 6 }}>
                <input className="input input-sm" type="number" value={custom.w} onChange={(e) => setCustom((c) => ({ ...c, w: e.target.value }))} aria-label="Width" />
                <span>×</span>
                <input className="input input-sm" type="number" value={custom.h} onChange={(e) => setCustom((c) => ({ ...c, h: e.target.value }))} aria-label="Height" />
              </div>
            )}

            <div className="photo-section-label">Spacing &amp; shape</div>
            {[
              ['Spacing', spacing, setSpacing, 0, 80],
              ['Outer margin', margin, setMargin, 0, 120],
              ['Rounded corners', radius, setRadius, 0, 150],
            ].map(([label, value, set, min, max]) => (
              <label key={label} className="photo-slider">
                <span className="photo-slider-head"><span>{label}</span><span className="photo-slider-value">{value}</span></span>
                <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
              </label>
            ))}

            <div className="photo-section-label">Background</div>
            <div className="collage-bgs">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} type="button" className={bg === b.id ? 'active' : ''} style={{ background: backgroundCss(b.id) }} onClick={() => setBg(b.id)} title={b.label} />
              ))}
              <label className={`collage-bg-custom${bg === 'custom' ? ' active' : ''}`} title="Custom colour">
                <input type="color" value={bgCustom} onChange={(e) => { setBgCustom(e.target.value); setBg('custom'); }} />
              </label>
            </div>

            <div className="photo-section-label">Caption</div>
            <input className="input input-sm" placeholder="Optional title, e.g. Summer 2026" value={caption.text} onChange={(e) => setCaption((c) => ({ ...c, text: e.target.value }))} />
            {caption.text && (
              <>
                <div className="photo-text-grid" style={{ marginTop: 6 }}>
                  <select className="input input-sm" value={caption.font} onChange={(e) => setCaption((c) => ({ ...c, font: e.target.value }))}>
                    {FONTS.map((fo) => (
                      <option key={fo.id} value={fo.id}>{fo.label}</option>
                    ))}
                  </select>
                  <input type="color" value={caption.color} onChange={(e) => setCaption((c) => ({ ...c, color: e.target.value }))} />
                  {['top', 'center', 'bottom'].map((pos) => (
                    <button key={pos} type="button" className={`btn btn-sm${caption.position === pos ? ' btn-primary' : ''}`} onClick={() => setCaption((c) => ({ ...c, position: pos }))}>
                      {pos[0].toUpperCase() + pos.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Caption size</span><span className="photo-slider-value">{caption.size}</span></span>
                  <input type="range" min={2} max={20} value={caption.size} onChange={(e) => setCaption((c) => ({ ...c, size: Number(e.target.value) }))} />
                </label>
                <label className="checkbox-row"><input type="checkbox" checked={caption.band} onChange={(e) => setCaption((c) => ({ ...c, band: e.target.checked }))} /><span>Dark band behind text</span></label>
              </>
            )}
            {credits.length > 0 && <p className="field-hint">Pexels photos by {credits.join(', ')}.</p>}
          </div>
        </aside>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      {pexels && <PexelsPicker multiple max={MAX_IMAGES - images.length} title="Add stock photos from Pexels" onPick={addPexels} onClose={() => setPexels(false)} />}
    </div>
  );
}
