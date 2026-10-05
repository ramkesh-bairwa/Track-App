'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import { buildPdf, canvasToJpeg, PAGE_SIZES, MM } from '@/lib/pdfWriter';

const MAX_SIDE = 8192; // browsers struggle with canvases larger than this
const MAX_PIXELS = 40_000_000;
const PREVIEW_MAX = 1100;

const LAYOUTS = [
  { id: 'vertical', label: 'Vertical', icon: 'fa-solid fa-grip-lines', hint: 'Stacked top to bottom' },
  { id: 'horizontal', label: 'Horizontal', icon: 'fa-solid fa-grip-lines-vertical', hint: 'Side by side' },
  { id: 'grid', label: 'Grid', icon: 'fa-solid fa-table-cells', hint: 'Rows and columns' },
];
const CELL_SHAPES = [
  { id: 'square', label: 'Square', r: 1 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '3:4', label: '3:4', r: 3 / 4 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: 'auto', label: 'Like 1st photo', r: null },
];

let nextId = 1;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`“${file.name}” could not be opened as an image.`));
    };
    img.src = url;
  });
}

// The photo as drawn: rotated by 0/90/180/270°.
function photoSize(p) {
  const turned = p.rotate % 180 !== 0;
  return { w: turned ? p.img.naturalHeight : p.img.naturalWidth, h: turned ? p.img.naturalWidth : p.img.naturalHeight };
}

function drawPhoto(ctx, p, x, y, w, h, fit, radius) {
  const { w: pw, h: ph } = photoSize(p);
  // "cover" crops to fill the box; "contain" fits inside it.
  let dw = w;
  let dh = h;
  if (fit === 'cover' || fit === 'contain') {
    const scale = fit === 'cover' ? Math.max(w / pw, h / ph) : Math.min(w / pw, h / ph);
    dw = pw * scale;
    dh = ph * scale;
  }
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.beginPath();
  const r = Math.min(radius, w / 2, h / 2);
  if (fit === 'contain') {
    const cr = Math.min(radius, dw / 2, dh / 2);
    if (ctx.roundRect) ctx.roundRect(dx, dy, dw, dh, cr);
    else ctx.rect(dx, dy, dw, dh);
  } else if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate((p.rotate * Math.PI) / 180);
  const turned = p.rotate % 180 !== 0;
  const iw = turned ? dh : dw;
  const ih = turned ? dw : dh;
  ctx.drawImage(p.img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

// Where every photo goes. → { width, height, boxes: [{ p, x, y, w, h, fit }] }
function computeLayout(photos, o) {
  const pad = o.padding;
  const gap = o.gap;
  const boxes = [];
  if (!photos.length) return { width: 0, height: 0, boxes };

  if (o.layout === 'vertical' || o.layout === 'horizontal') {
    const vertical = o.layout === 'vertical';
    // "Same size": every photo scaled to one width (vertical) / height
    // (horizontal). "Original": each keeps its own size, aligned.
    const sizes = photos.map((p) => {
      const s = photoSize(p);
      if (o.sizing === 'original') return s;
      return vertical ? { w: o.size, h: (o.size * s.h) / s.w } : { w: (o.size * s.w) / s.h, h: o.size };
    });
    const across = Math.max(...sizes.map((s) => (vertical ? s.w : s.h)));
    let at = pad;
    sizes.forEach((s, i) => {
      const off = o.align === 'start' ? 0 : o.align === 'end' ? across - (vertical ? s.w : s.h) : (across - (vertical ? s.w : s.h)) / 2;
      boxes.push(
        vertical
          ? { p: photos[i], x: pad + off, y: at, w: s.w, h: s.h, fit: 'fill' }
          : { p: photos[i], x: at, y: pad + off, w: s.w, h: s.h, fit: 'fill' }
      );
      at += (vertical ? s.h : s.w) + gap;
    });
    const along = at - gap + pad;
    return vertical ? { width: across + 2 * pad, height: along, boxes } : { width: along, height: across + 2 * pad, boxes };
  }

  // grid
  const cols = Math.max(1, Math.min(o.columns, photos.length));
  const rows = Math.ceil(photos.length / cols);
  const first = photoSize(photos[0]);
  const ratio = CELL_SHAPES.find((c) => c.id === o.cell)?.r || first.w / first.h;
  const cellW = (o.size - gap * (cols - 1)) / cols;
  const cellH = cellW / ratio;
  photos.forEach((p, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // Centre a short last row.
    const inRow = r === rows - 1 ? photos.length - r * cols : cols;
    const shift = o.align === 'center' ? ((cols - inRow) * (cellW + gap)) / 2 : o.align === 'end' ? (cols - inRow) * (cellW + gap) : 0;
    boxes.push({ p, x: pad + shift + c * (cellW + gap), y: pad + r * (cellH + gap), w: cellW, h: cellH, fit: o.fit });
  });
  return { width: o.size + 2 * pad, height: rows * cellH + (rows - 1) * gap + 2 * pad, boxes };
}

// Draw the whole layout at `scale` (1 = full resolution).
function render(photos, o, scale = 1) {
  const layout = computeLayout(photos, o);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (o.background !== 'transparent') {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  for (const b of layout.boxes) drawPhoto(ctx, b.p, b.x, b.y, b.w, b.h, b.fit, o.radius);
  return { canvas, layout };
}

// Largest scale ≤ 1 that keeps the output inside browser canvas limits.
function safeScale(width, height) {
  return Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function PhotoCombine() {
  const [photos, setPhotos] = useState([]); // { id, name, img, url, rotate }
  const [layout, setLayout] = useState('vertical');
  const [sizing, setSizing] = useState('same'); // same | original
  const [size, setSize] = useState(1600);
  const [columns, setColumns] = useState(2);
  const [cell, setCell] = useState('square');
  const [fit, setFit] = useState('cover');
  const [align, setAlign] = useState('center');
  const [gap, setGap] = useState(16);
  const [padding, setPadding] = useState(16);
  const [radius, setRadius] = useState(0);
  const [background, setBackground] = useState('#ffffff');
  const [format, setFormat] = useState('pdf');
  const [quality, setQuality] = useState(90);
  const [pdfMode, setPdfMode] = useState('single'); // single | pages
  const [pdfPage, setPdfPage] = useState('a4');
  const [pdfOrientation, setPdfOrientation] = useState('auto');
  const [pdfMargin, setPdfMargin] = useState(10);
  const [name, setName] = useState('photos');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const fileRef = useRef(null);
  const previewRef = useRef(null);

  const options = useMemo(
    () => ({ layout, sizing, size, columns, cell, fit, align, gap, padding, radius, background }),
    [layout, sizing, size, columns, cell, fit, align, gap, padding, radius, background]
  );

  const addFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setError('');
    setBusy(`Opening ${files.length} photo${files.length === 1 ? '' : 's'}…`);
    const added = [];
    for (const f of files) {
      try {
        const { img, url } = await loadImage(f);
        added.push({ id: nextId++, name: f.name, img, url, rotate: 0 });
      } catch (err) {
        setError(err.message);
      }
    }
    setPhotos((list) => {
      if (!list.length && added[0]) setName(added[0].name.replace(/\.[^.]+$/, '') || 'photos');
      return [...list, ...added];
    });
    setBusy('');
  }, []);

  // Paste images from the clipboard.
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

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview, drawn small.
  const info = useMemo(() => (photos.length ? computeLayout(photos, options) : null), [photos, options]);
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.innerHTML = '';
    if (!info) return;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(info.width, info.height));
    const { canvas } = render(photos, options, scale);
    canvas.className = 'combine-canvas';
    host.appendChild(canvas);
  }, [photos, options, info]);

  const outScale = info ? safeScale(info.width, info.height) : 1;
  const outW = info ? Math.round(info.width * outScale) : 0;
  const outH = info ? Math.round(info.height * outScale) : 0;

  function move(id, dir) {
    setPhotos((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = list.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function dropOn(targetId) {
    if (dragId == null || dragId === targetId) return;
    setPhotos((list) => {
      const from = list.findIndex((p) => p.id === dragId);
      const to = list.findIndex((p) => p.id === targetId);
      const next = list.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }

  function remove(id) {
    setPhotos((list) => {
      const p = list.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return list.filter((x) => x.id !== id);
    });
  }

  async function download() {
    if (!photos.length) return;
    setError('');
    setBusy(format === 'pdf' ? 'Building PDF…' : 'Creating image…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const base = safeFilename(name, 'photos');
      const bg = background === 'transparent' ? '#ffffff' : background;
      if (format !== 'pdf') {
        const { canvas } = render(photos, { ...options, background: format === 'image/jpeg' && background === 'transparent' ? '#ffffff' : background }, outScale);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality / 100));
        if (!blob) throw new Error('Your browser could not create that image.');
        downloadBlob(blob, `${base}.${format === 'image/png' ? 'png' : 'jpg'}`);
      } else if (pdfMode === 'single') {
        // The whole layout on one page, sized to the picture (at 96 dpi).
        const { canvas } = render(photos, { ...options, background: bg }, outScale);
        const jpeg = await canvasToJpeg(canvas, quality / 100, bg);
        const w = info.width * 0.75;
        const h = info.height * 0.75;
        const pdf = buildPdf([{ width: w, height: h, images: [{ jpeg, x: 0, y: 0, w, h }] }], { title: name });
        downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${base}.pdf`);
      } else {
        // One photo per page, fitted inside the margins.
        const pages = [];
        for (const [i, p] of photos.entries()) {
          setBusy(`Building PDF… page ${i + 1} of ${photos.length}`);
          const s = photoSize(p);
          const one = document.createElement('canvas');
          const sc = safeScale(s.w, s.h);
          one.width = Math.round(s.w * sc);
          one.height = Math.round(s.h * sc);
          drawPhoto(one.getContext('2d'), p, 0, 0, one.width, one.height, 'fill', 0);
          const jpeg = await canvasToJpeg(one, quality / 100, '#ffffff');
          let pw;
          let ph;
          if (pdfPage === 'fit') {
            pw = s.w * 0.75 + 2 * pdfMargin * MM;
            ph = s.h * 0.75 + 2 * pdfMargin * MM;
          } else {
            const paper = PAGE_SIZES[pdfPage];
            const landscape = pdfOrientation === 'landscape' || (pdfOrientation === 'auto' && s.w > s.h);
            pw = landscape ? paper.h : paper.w;
            ph = landscape ? paper.w : paper.h;
          }
          const m = pdfMargin * MM;
          const scale = Math.min((pw - 2 * m) / s.w, (ph - 2 * m) / s.h);
          const w = s.w * scale;
          const h = s.h * scale;
          pages.push({
            width: pw,
            height: ph,
            background: background === 'transparent' || background === '#ffffff' ? null : hexToRgb(background),
            images: [{ jpeg, x: (pw - w) / 2, y: (ph - h) / 2, w, h }],
          });
        }
        const pdf = buildPdf(pages, { title: name });
        downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${base}.pdf`);
      }
    } catch (err) {
      setError(err.message || 'Could not create the file.');
    } finally {
      setBusy('');
    }
  }

  const slider = (label, value, set, min, max, unit = 'px') => (
    <div className="photo-slider">
      <div className="photo-slider-head">
        <span>{label}</span>
        <span className="photo-slider-value">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Combine photos</h1>
          <p>Put several photos together — stacked vertically, side by side, or in a grid — and download as an image or PDF. Everything happens in your browser.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>＋ Add photos</button>
          {photos.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => { photos.forEach((p) => URL.revokeObjectURL(p.url)); setPhotos([]); }}>
              Clear all
            </button>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      {error && <div className="top-error">{error}</div>}

      {photos.length === 0 ? (
        <div
          className={`photo-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        >
          <i className="fa-solid fa-images" />
          <strong>{busy || 'Drop photos here, or click to choose several'}</strong>
          <span>JPG, PNG, WEBP or GIF · select many at once · you can also paste (Ctrl/⌘+V)</span>
        </div>
      ) : (
        <div className="combine">
          <div className="combine-main">
            <div
              className={`combine-strip${dragging ? ' dragging' : ''}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}
            >
              {photos.map((p, i) => (
                <div
                  key={p.id}
                  className={`combine-thumb${dragId === p.id ? ' dragging' : ''}${overId === p.id ? ' over' : ''}`}
                  draggable
                  onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(p.id)); }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setOverId(p.id); } }}
                  onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
                  onDrop={(e) => { if (dragId != null) { e.preventDefault(); e.stopPropagation(); dropOn(p.id); setOverId(null); } }}
                  title={`${p.name} — drag to reorder`}
                >
                  <span className="combine-num">{i + 1}</span>
                  <img src={p.url} alt={p.name} style={{ transform: `rotate(${p.rotate}deg)` }} draggable={false} />
                  <div className="combine-thumb-actions">
                    <button type="button" onClick={() => move(p.id, -1)} disabled={i === 0} title="Move earlier">←</button>
                    <button type="button" onClick={() => setPhotos((l) => l.map((x) => (x.id === p.id ? { ...x, rotate: (x.rotate + 90) % 360 } : x)))} title="Rotate 90°">⟳</button>
                    <button type="button" onClick={() => move(p.id, 1)} disabled={i === photos.length - 1} title="Move later">→</button>
                    <button type="button" className="danger" onClick={() => remove(p.id)} title="Remove">×</button>
                  </div>
                </div>
              ))}
              <button type="button" className="combine-add" onClick={() => fileRef.current?.click()} title="Add more photos">
                <i className="fa-solid fa-plus" />
                <span>Add</span>
              </button>
            </div>
            <div className="combine-preview-wrap">
              <div className="combine-preview" ref={previewRef} style={{ background: background === 'transparent' ? undefined : 'transparent' }} />
              {busy && <div className="photo-busy"><span className="photo-spinner" />{busy}</div>}
            </div>
            <p className="combine-size">
              {photos.length} photo{photos.length === 1 ? '' : 's'} · output {outW.toLocaleString()} × {outH.toLocaleString()} px
              {outScale < 1 && ' (scaled down to stay within browser limits)'}
            </p>
          </div>

          <aside className="photo-panel combine-panel">
            <div className="photo-panel-body">
              <div className="photo-section-label">Layout</div>
              <div className="combine-layouts">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" className={`combine-layout${layout === l.id ? ' active' : ''}`} onClick={() => setLayout(l.id)} title={l.hint}>
                    <i className={l.icon} />
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>

              {layout !== 'grid' ? (
                <>
                  <div className="photo-section-label">Photo size</div>
                  <div className="photo-btn-row">
                    <button type="button" className={`btn btn-sm${sizing === 'same' ? ' btn-primary' : ''}`} onClick={() => setSizing('same')}>
                      Same {layout === 'vertical' ? 'width' : 'height'}
                    </button>
                    <button type="button" className={`btn btn-sm${sizing === 'original' ? ' btn-primary' : ''}`} onClick={() => setSizing('original')}>Original sizes</button>
                  </div>
                  {sizing === 'same' && slider(layout === 'vertical' ? 'Width' : 'Height', size, setSize, 300, 4000)}
                </>
              ) : (
                <>
                  {slider('Columns', columns, setColumns, 1, 8, '')}
                  <div className="photo-section-label">Cell shape</div>
                  <div className="photo-btn-row">
                    {CELL_SHAPES.map((c) => (
                      <button key={c.id} type="button" className={`btn btn-sm${cell === c.id ? ' btn-primary' : ''}`} onClick={() => setCell(c.id)}>{c.label}</button>
                    ))}
                  </div>
                  <div className="photo-section-label">Fit</div>
                  <div className="photo-btn-row">
                    <button type="button" className={`btn btn-sm${fit === 'cover' ? ' btn-primary' : ''}`} onClick={() => setFit('cover')} title="Fill each cell, cropping edges">Fill (crop)</button>
                    <button type="button" className={`btn btn-sm${fit === 'contain' ? ' btn-primary' : ''}`} onClick={() => setFit('contain')} title="Show the whole photo">Whole photo</button>
                  </div>
                  {slider('Total width', size, setSize, 400, 4000)}
                </>
              )}

              {(sizing === 'original' || layout === 'grid') && (
                <>
                  <div className="photo-section-label">Align</div>
                  <div className="photo-btn-row">
                    {[['start', layout === 'horizontal' ? 'Top' : 'Left'], ['center', 'Center'], ['end', layout === 'horizontal' ? 'Bottom' : 'Right']].map(([v, l]) => (
                      <button key={v} type="button" className={`btn btn-sm${align === v ? ' btn-primary' : ''}`} onClick={() => setAlign(v)}>{l}</button>
                    ))}
                  </div>
                </>
              )}

              <div className="photo-section-label">Spacing & style</div>
              {slider('Gap between photos', gap, setGap, 0, 120)}
              {slider('Outer margin', padding, setPadding, 0, 200)}
              {slider('Rounded corners', radius, setRadius, 0, 120)}
              <div className="combine-bg">
                <span>Background</span>
                {['#ffffff', '#000000', '#f3f4f6', '#1f2937', '#fef3c7', 'transparent'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`combine-swatch${background === c ? ' active' : ''}${c === 'transparent' ? ' clear' : ''}`}
                    style={c === 'transparent' ? undefined : { background: c }}
                    onClick={() => setBackground(c)}
                    title={c === 'transparent' ? 'Transparent (PNG only)' : c}
                  />
                ))}
                <input type="color" value={background === 'transparent' ? '#ffffff' : background} onChange={(e) => setBackground(e.target.value)} title="Custom colour" />
              </div>

              <div className="photo-section-label">Download</div>
              <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="File name" aria-label="File name" />
              <div className="photo-btn-row">
                {[['pdf', 'PDF'], ['image/jpeg', 'JPG'], ['image/png', 'PNG']].map(([v, l]) => (
                  <button key={v} type="button" className={`btn btn-sm${format === v ? ' btn-primary' : ''}`} onClick={() => setFormat(v)}>{l}</button>
                ))}
              </div>
              {format === 'pdf' && (
                <>
                  <div className="photo-btn-row">
                    <button type="button" className={`btn btn-sm${pdfMode === 'single' ? ' btn-primary' : ''}`} onClick={() => setPdfMode('single')} title="The whole layout on one page">This layout, 1 page</button>
                    <button type="button" className={`btn btn-sm${pdfMode === 'pages' ? ' btn-primary' : ''}`} onClick={() => setPdfMode('pages')} title="Each photo on its own page">1 photo per page</button>
                  </div>
                  {pdfMode === 'pages' && (
                    <>
                      <div className="combine-row">
                        <select className="input input-sm" value={pdfPage} onChange={(e) => setPdfPage(e.target.value)} aria-label="Page size">
                          {Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          <option value="fit">Fit each photo</option>
                        </select>
                        {pdfPage !== 'fit' && (
                          <select className="input input-sm" value={pdfOrientation} onChange={(e) => setPdfOrientation(e.target.value)} aria-label="Orientation">
                            <option value="auto">Auto-rotate</option>
                            <option value="portrait">Portrait</option>
                            <option value="landscape">Landscape</option>
                          </select>
                        )}
                      </div>
                      {slider('Page margin', pdfMargin, setPdfMargin, 0, 40, ' mm')}
                    </>
                  )}
                </>
              )}
              {format !== 'image/png' && slider('Quality', quality, setQuality, 40, 100, '%')}
              {background === 'transparent' && format !== 'image/png' && (
                <p className="field-hint">Transparent areas become white in {format === 'pdf' ? 'PDF' : 'JPG'}.</p>
              )}
              <button type="button" className="btn btn-primary combine-download" onClick={download} disabled={Boolean(busy)}>
                <i className="fa-solid fa-download" /> Download {format === 'pdf' ? 'PDF' : format === 'image/png' ? 'PNG' : 'JPG'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
