'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openPdfForView, renderPageToCanvas, buildPdf, extractText, displaySize, PAGE_SIZES } from '@/lib/pdfTools';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import PexelsPicker, { pexelsProxy } from '@/components/photo/PexelsPicker';

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'fa-solid fa-arrow-pointer', hint: 'Click an item to select it; drag to move, drag the corner to resize.' },
  { id: 'text', label: 'Text', icon: 'fa-solid fa-font', hint: 'Click on the page where the text should go.' },
  { id: 'highlight', label: 'Highlight', icon: 'fa-solid fa-highlighter', hint: 'Drag over the area to highlight.' },
  { id: 'whiteout', label: 'White-out', icon: 'fa-solid fa-eraser', hint: 'Drag over anything you want to cover up.' },
  { id: 'rect', label: 'Box', icon: 'fa-regular fa-square', hint: 'Drag to draw a box outline.' },
  { id: 'ink', label: 'Draw', icon: 'fa-solid fa-pen', hint: 'Draw freehand on the page.' },
  { id: 'image', label: 'Image', icon: 'fa-regular fa-image', hint: 'Adds an image — then move and resize it.' },
  { id: 'sign', label: 'Sign', icon: 'fa-solid fa-signature', hint: 'Draw your signature, then place it.' },
];

let uid = 1;
const newId = () => uid++;

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) r.readAsArrayBuffer(file);
    else r.readAsDataURL(file);
  });
}

function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => reject(new Error('That image could not be opened.'));
    i.src = dataUrl;
  });
}

function SignaturePad({ onDone, onClose }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [color, setColor] = useState('#1a2a6c');
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current;
    c.width = 900;
    c.height = 300;
  }, []);
  function pos(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 900, y: ((e.clientY - r.top) / r.height) * 300 };
  }
  function down(e) {
    drawing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!drawing.current) return;
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setEmpty(false);
  }
  function done() {
    // Trim to the ink so the signature places snugly.
    const c = ref.current;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 <= x0) return;
    const t = document.createElement('canvas');
    t.width = x1 - x0 + 12;
    t.height = y1 - y0 + 12;
    t.getContext('2d').drawImage(c, x0 - 6, y0 - 6, t.width, t.height, 0, 0, t.width, t.height);
    onDone(t.toDataURL('image/png'), t.width / t.height);
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="new-track-head">
          <h2>Draw your signature</h2>
          <button type="button" className="new-track-close" onClick={onClose}>×</button>
        </div>
        <canvas ref={ref} className="pdf-sign-pad" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} />
        <div className="modal-actions">
          <div className="photo-swatches" style={{ marginRight: 'auto' }}>
            {['#1a2a6c', '#000000', '#0b6e4f', '#b00020'].map((c) => (
              <button key={c} type="button" style={{ background: c, outline: color === c ? '2px solid var(--accent)' : 'none' }} onClick={() => setColor(c)} />
            ))}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => { ref.current.getContext('2d').clearRect(0, 0, 900, 300); setEmpty(true); }}>Clear</button>
          <button type="button" className="btn btn-primary" onClick={done} disabled={empty}>Use signature</button>
        </div>
      </div>
    </div>
  );
}

export default function PdfEditor({ active = true }) {
  const fileRef = useRef(null);
  const mergeRef = useRef(null);
  const imageRef = useRef(null);
  const pageCanvasRef = useRef(null);
  const stageRef = useRef(null);
  const sources = useRef(new Map()); // id → { bytes, view (pdf.js doc), name }
  const thumbs = useRef(new Map()); // page entry id → dataURL
  const draft = useRef(null);

  const [pages, setPages] = useState([]);
  const [current, setCurrent] = useState(0);
  const [checked, setChecked] = useState(new Set());
  const [tool, setTool] = useState('select');
  const [style, setStyle] = useState({ color: '#d0021b', size: 0.022, bold: false, stroke: 0.004 });
  const [selectedAnn, setSelectedAnn] = useState(null);
  const [editingText, setEditingText] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fileName, setFileName] = useState('document');
  const [, setThumbTick] = useState(0);
  const [dragPage, setDragPage] = useState(null);
  const [showSign, setShowSign] = useState(false);
  const [pexels, setPexels] = useState(null); // 'annotation' | 'pages'
  const [saveOpts, setSaveOpts] = useState({ pageNumbers: '', watermark: '', title: '', author: '' });
  const [showSave, setShowSave] = useState(false);
  const [pendingImage, setPendingImage] = useState(null); // placed on next click
  const [history, setHistory] = useState([]);

  const page = pages[current];

  // ---------- undo ----------
  function commit(next) {
    setHistory((h) => [...h.slice(-40), pages]);
    setPages(next);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      setPages(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setSelectedAnn(null);
  }

  // ---------- loading ----------
  async function addPdf(buffer, name, { replace = false } = {}) {
    const bytes = new Uint8Array(buffer);
    const view = await openPdfForView(bytes);
    const id = newId();
    sources.current.set(id, { bytes, view, name });
    const added = [];
    for (let i = 0; i < view.numPages; i++) {
      const pg = await view.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1, rotation: 0 });
      added.push({ id: newId(), kind: 'pdf', sourceId: id, pageIndex: i, width: vp.width, height: vp.height, baseRotation: pg.rotate || 0, rotation: 0, annotations: [] });
    }
    return replace ? added : added;
  }

  async function openFiles(fileList, mode = 'open') {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setBusy('Opening…');
    setError('');
    try {
      let next = mode === 'open' ? [] : [...pages];
      for (const f of files) {
        const data = await readFile(f);
        if (data instanceof ArrayBuffer) next = [...next, ...(await addPdf(data, f.name))];
        else if (typeof data === 'string' && data.startsWith('data:image/')) next = [...next, await imagePage(data)];
        else throw new Error(`${f.name} isn’t a PDF or an image.`);
      }
      if (mode === 'open') {
        setHistory([]);
        setFileName(files[0].name.replace(/\.[^.]+$/, '') || 'document');
        setCurrent(0);
        setPages(next);
      } else {
        commit(next);
        setNotice(`Added ${next.length - pages.length} page${next.length - pages.length === 1 ? '' : 's'}.`);
      }
      setChecked(new Set());
    } catch (err) {
      setError(/password|encrypt/i.test(err.message) ? 'That PDF is password-protected — remove the password first.' : err.message);
    } finally {
      setBusy('');
    }
  }

  async function imagePage(dataUrl) {
    const { w, h } = await imageSize(dataUrl);
    // Fit to A4 in the image's orientation.
    const a4 = PAGE_SIZES[0];
    const portrait = h >= w;
    return { id: newId(), kind: 'image', image: dataUrl, width: portrait ? a4.w : a4.h, height: portrait ? a4.h : a4.w, baseRotation: 0, rotation: 0, annotations: [] };
  }

  function newBlank(sizeId = 'a4') {
    const s = PAGE_SIZES.find((x) => x.id === sizeId);
    return { id: newId(), kind: 'blank', width: s.w, height: s.h, baseRotation: 0, rotation: 0, annotations: [] };
  }

  // ---------- thumbnails & page render ----------
  const renderEntry = useCallback(async (entry, targetWidth, canvas) => {
    const rot = (entry.baseRotation || 0) + (entry.rotation || 0);
    const disp = displaySize(entry.width, entry.height, rot);
    const scale = targetWidth / disp.w;
    if (entry.kind === 'pdf') {
      const src = sources.current.get(entry.sourceId);
      const pg = await src.view.getPage(entry.pageIndex + 1);
      return renderPageToCanvas(pg, { scale, rotation: entry.rotation || 0, canvas });
    }
    const c = canvas || document.createElement('canvas');
    c.width = Math.round(disp.w * scale);
    c.height = Math.round(disp.h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (entry.kind === 'image') {
      const img = await new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = entry.image;
      });
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(((entry.rotation || 0) * Math.PI) / 180);
      const pw = entry.width * scale;
      const ph = entry.height * scale;
      const k = Math.min(pw / img.naturalWidth, ph / img.naturalHeight);
      ctx.drawImage(img, (-img.naturalWidth * k) / 2, (-img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      ctx.restore();
    }
    return c;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of pages) {
        const key = `${p.id}:${p.rotation}`;
        if (thumbs.current.has(key)) continue;
        try {
          const c = await renderEntry(p, 150);
          if (cancelled) return;
          thumbs.current.set(key, c.toDataURL('image/jpeg', 0.7));
          setThumbTick((t) => t + 1);
        } catch {
          // ignore a page that fails to render; it still saves
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages, renderEntry]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length > 0]);

  const disp = page ? displaySize(page.width, page.height, (page.baseRotation || 0) + (page.rotation || 0)) : { w: 1, h: 1 };
  const fitWidth = Math.max(200, Math.min(stageSize.w - 40, ((stageSize.h - 40) * disp.w) / disp.h || 800));
  const viewW = Math.round(fitWidth * zoom);
  const viewH = Math.round((viewW * disp.h) / disp.w);

  useEffect(() => {
    if (!page || !pageCanvasRef.current) return undefined;
    let cancelled = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderEntry(page, viewW * dpr).then((c) => {
      if (cancelled || !pageCanvasRef.current) return;
      const target = pageCanvasRef.current;
      target.width = c.width;
      target.height = c.height;
      target.getContext('2d').drawImage(c, 0, 0);
    }).catch((err) => setError(`Could not show this page: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [page?.id, page?.rotation, viewW, renderEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- page operations ----------
  const targetIndexes = () => (checked.size ? [...checked].map((id) => pages.findIndex((p) => p.id === id)).filter((i) => i >= 0) : [current]);

  function rotatePages(dir) {
    const idx = new Set(targetIndexes());
    commit(pages.map((p, i) => (idx.has(i) ? { ...p, rotation: ((p.rotation || 0) + dir * 90 + 360) % 360, annotations: [] } : p)));
    if ([...idx].some((i) => pages[i].annotations.length)) setNotice('Rotating clears that page’s annotations — add them after rotating.');
  }
  function deletePages() {
    const idx = new Set(targetIndexes());
    if (idx.size >= pages.length) return setError('A PDF needs at least one page.');
    commit(pages.filter((_, i) => !idx.has(i)));
    setChecked(new Set());
    setCurrent((c) => Math.max(0, Math.min(c, pages.length - idx.size - 1)));
  }
  function duplicatePages() {
    const idx = targetIndexes().sort((a, b) => a - b);
    const next = [...pages];
    let offset = 0;
    for (const i of idx) {
      next.splice(i + 1 + offset, 0, { ...pages[i], id: newId(), annotations: pages[i].annotations.map((a) => ({ ...a, id: newId() })) });
      offset++;
    }
    commit(next);
  }
  function insertBlank() {
    const next = [...pages];
    const ref = pages[current];
    const blank = newBlank();
    if (ref) {
      blank.width = ref.width;
      blank.height = ref.height;
    }
    next.splice(current + 1, 0, blank);
    commit(next);
    setCurrent(current + 1);
  }
  function movePage(from, to) {
    if (from === to || from == null) return;
    const next = [...pages];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    commit(next);
    setCurrent(to);
  }
  function selectAll(on) {
    setChecked(on ? new Set(pages.map((p) => p.id)) : new Set());
  }

  // ---------- annotations ----------
  function updatePage(fn) {
    commit(pages.map((p, i) => (i === current ? fn(p) : p)));
  }
  function addAnnotation(a) {
    const ann = { id: newId(), ...a };
    updatePage((p) => ({ ...p, annotations: [...p.annotations, ann] }));
    setSelectedAnn(ann.id);
    return ann;
  }
  function patchAnnotation(id, patch, { record = true } = {}) {
    const next = pages.map((p, i) => (i === current ? { ...p, annotations: p.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) } : p));
    if (record) commit(next);
    else setPages(next);
  }
  function deleteAnnotation(id) {
    updatePage((p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== id) }));
    setSelectedAnn(null);
  }

  function frac(e) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  function onPageDown(e) {
    if (!page || e.target !== e.currentTarget) return;
    // Stop the browser moving focus to the page on mouse-down — otherwise a
    // just-created text box loses focus at once (and, being empty, vanishes).
    e.preventDefault();
    const p = frac(e);
    setSelectedAnn(null);
    if (pendingImage) {
      const w = 0.3;
      const h = (w * disp.w) / disp.h / pendingImage.ratio;
      addAnnotation({ type: 'image', image: pendingImage.src, x: Math.min(p.x, 1 - w), y: Math.min(p.y, 1 - h), w, h });
      setPendingImage(null);
      setTool('select');
      return;
    }
    if (tool === 'text') {
      const ann = addAnnotation({ type: 'text', x: p.x, y: p.y, text: '', color: style.color, size: style.size, bold: style.bold });
      setEditingText(ann.id);
      setTool('select');
      return;
    }
    if (['highlight', 'whiteout', 'rect', 'ink'].includes(tool)) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      draft.current = { tool, start: p, points: [p] };
      setDraftView({ tool, x: p.x, y: p.y, w: 0, h: 0, points: [p] });
    }
  }
  const [draftView, setDraftView] = useState(null);

  function onPageMove(e) {
    const d = draft.current;
    if (!d) return;
    const p = frac(e);
    if (d.tool === 'ink') {
      d.points.push(p);
      setDraftView({ tool: 'ink', points: [...d.points] });
    } else {
      setDraftView({ tool: d.tool, x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
    }
  }

  function onPageUp() {
    const d = draft.current;
    draft.current = null;
    const v = draftView;
    setDraftView(null);
    if (!d || !v) return;
    if (d.tool === 'ink') {
      if (v.points.length > 1) addAnnotation({ type: 'ink', points: v.points, color: style.color, stroke: style.stroke });
    } else if (v.w > 0.005 && v.h > 0.003) {
      addAnnotation({
        type: d.tool,
        x: v.x,
        y: v.y,
        w: v.w,
        h: v.h,
        color: d.tool === 'highlight' ? (style.color === '#d0021b' ? '#ffe600' : style.color) : style.color,
        stroke: style.stroke,
      });
    }
  }

  // Moving / resizing an annotation.
  const moving = useRef(null);
  function onAnnDown(e, a, mode = 'move') {
    if (tool !== 'select' && !(mode === 'move' && tool === 'text')) return;
    e.stopPropagation();
    setSelectedAnn(a.id);
    const layer = e.currentTarget.closest('.pdf-page-layer').getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    moving.current = { id: a.id, mode, sx: e.clientX, sy: e.clientY, a, lw: layer.width, lh: layer.height, before: pages };
  }
  function onAnnMove(e) {
    const m = moving.current;
    if (!m) return;
    const dx = (e.clientX - m.sx) / m.lw;
    const dy = (e.clientY - m.sy) / m.lh;
    if (m.mode === 'move') {
      if (m.a.type === 'ink') patchAnnotation(m.id, { points: m.a.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) }, { record: false });
      else patchAnnotation(m.id, { x: m.a.x + dx, y: m.a.y + dy }, { record: false });
    } else {
      const w = Math.max(0.02, m.a.w + dx);
      const h = m.a.type === 'image' ? (w * m.a.h) / m.a.w : Math.max(0.01, m.a.h + dy);
      patchAnnotation(m.id, { w, h }, { record: false });
    }
  }
  function onAnnUp() {
    const m = moving.current;
    moving.current = null;
    if (m) setHistory((h) => [...h.slice(-40), m.before]);
  }

  useEffect(() => {
    if (!active) return undefined;
    function onKey(e) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnn) {
        e.preventDefault();
        deleteAnnotation(selectedAnn);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'ArrowRight' && !selectedAnn) setCurrent((c) => Math.min(pages.length - 1, c + 1));
      else if (e.key === 'ArrowLeft' && !selectedAnn) setCurrent((c) => Math.max(0, c - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function addImageFile(file) {
    if (!file) return;
    const data = await readFile(file);
    const { w, h } = await imageSize(data);
    setPendingImage({ src: data, ratio: w / h });
    setNotice('Click on the page to place the image.');
  }

  async function pexelsToDataUrl(photo) {
    const res = await fetch(pexelsProxy(photo.large));
    if (!res.ok) throw new Error('Could not download that Pexels photo.');
    const blob = await res.blob();
    return new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  async function addPexels(photos, mode) {
    setBusy(`Downloading ${photos.length} photo${photos.length === 1 ? '' : 's'} from Pexels…`);
    setError('');
    try {
      if (mode === 'pages') {
        const added = [];
        for (const ph of photos) added.push(await imagePage(await pexelsToDataUrl(ph)));
        if (!pages.length) {
          setPages(added);
          setFileName('pexels-photos');
        } else commit([...pages, ...added]);
        setNotice(`Added ${added.length} page${added.length === 1 ? '' : 's'} (photos by ${[...new Set(photos.map((p) => p.photographer))].join(', ')} on Pexels).`);
      } else {
        const [ph] = photos;
        setPendingImage({ src: await pexelsToDataUrl(ph), ratio: ph.width / ph.height });
        setNotice(`Click on the page to place the photo by ${ph.photographer} (Pexels).`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  // ---------- export ----------
  async function save(onlyChecked = false) {
    setBusy('Building PDF…');
    setError('');
    try {
      const list = onlyChecked ? pages.filter((p) => checked.has(p.id)) : pages;
      const bytes = await buildPdf(new Map([...sources.current].map(([id, s]) => [id, s.bytes])), list, saveOpts);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${safeFilename(fileName, 'document')}${onlyChecked ? '-pages' : ''}.pdf`);
      setShowSave(false);
      setNotice(onlyChecked ? `Saved ${list.length} selected page${list.length === 1 ? '' : 's'} as a new PDF.` : 'PDF saved.');
    } catch (err) {
      setError(`Could not build the PDF: ${err.message}`);
    } finally {
      setBusy('');
    }
  }

  // Exports what the page will look like in the saved PDF, edits included.
  async function exportPageImage() {
    setBusy('Rendering page…');
    try {
      const bytes = await buildPdf(new Map([...sources.current].map(([id, src]) => [id, src.bytes])), [page], {});
      const view = await openPdfForView(new Uint8Array(bytes));
      const pg = await view.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const c = await renderPageToCanvas(pg, { scale: 2000 / Math.max(vp.width, vp.height) });
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      downloadBlob(blob, `${safeFilename(fileName, 'document')}-page-${current + 1}.png`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function exportText() {
    setBusy('Extracting text…');
    try {
      const bytes = await buildPdf(new Map([...sources.current].map(([id, s]) => [id, s.bytes])), pages, {});
      const view = await openPdfForView(new Uint8Array(bytes));
      const text = await extractText(view);
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFilename(fileName, 'document')}.txt`);
      if (!text.replace(/--- Page \d+ ---/g, '').trim()) setNotice('This PDF has no selectable text (it may be scanned images).');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const annCount = useMemo(() => pages.reduce((n, p) => n + p.annotations.length, 0), [pages]);
  const selected = page?.annotations.find((a) => a.id === selectedAnn);

  // ---------- empty state ----------
  if (!pages.length) {
    return (
      <>
        <div
          className="photo-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            openFiles(e.dataTransfer.files, 'open');
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <i className="fa-solid fa-file-pdf" />
          <strong>{busy || 'Drop a PDF here, or click to open one'}</strong>
          <span>Edit, sign, annotate, reorder, rotate, merge and split — all in your browser. Images become PDF pages too.</span>
        </div>
        <div className="photo-drop-alt">
          <button type="button" className="btn" onClick={() => { setPages([newBlank()]); setFileName('new-document'); }}>
            <i className="fa-regular fa-file" /> Start a blank PDF
          </button>
          <button type="button" className="btn" onClick={() => imageRef.current?.click()}>
            <i className="fa-regular fa-images" /> Images → PDF
          </button>
          <button type="button" className="btn" onClick={() => setPexels('pages')}>
            <i className="fa-solid fa-camera-retro" /> PDF from Pexels photos
          </button>
        </div>
        {error && <div className="top-error" style={{ marginTop: 12 }}>{error}</div>}
        <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={(e) => { openFiles(e.target.files, 'open'); e.target.value = ''; }} />
        <input ref={imageRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { openFiles(e.target.files, 'open'); e.target.value = ''; }} />
        {pexels && <PexelsPicker multiple max={30} title="Pexels photos → PDF pages" onPick={(photos) => addPexels(photos, 'pages')} onClose={() => setPexels(null)} />}
      </>
    );
  }

  const layerFont = (a) => Math.max(6, a.size * viewH);

  return (
    <div className="pdf-editor">
      <div className="photo-toolbar">
        <input className="input input-sm photo-name" value={fileName} onChange={(e) => setFileName(e.target.value)} aria-label="File name" />
        <span className="task-muted photo-dims">
          {pages.length} page{pages.length === 1 ? '' : 's'}{annCount ? ` · ${annCount} edit${annCount === 1 ? '' : 's'}` : ''}
        </span>
        <div className="photo-toolbar-actions">
          <button type="button" className="btn btn-sm" onClick={undo} disabled={!history.length}>↶ Undo</button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} title="Open a different PDF">Open…</button>
          <button type="button" className="btn btn-sm" onClick={() => mergeRef.current?.click()} title="Append PDFs or images">＋ Merge / add files</button>
          <button type="button" className="btn btn-sm" onClick={exportText} disabled={Boolean(busy)}>⬇ Text</button>
          <button type="button" className="btn btn-sm" onClick={exportPageImage} disabled={Boolean(busy)}>⬇ Page as PNG</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowSave(true)} disabled={Boolean(busy)}>⬇ Save PDF</button>
        </div>
      </div>
      {error && <div className="top-error">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="task-notice" onClick={() => setNotice('')}>{notice}</div>}

      <div className="pdf-main">
        <aside className="pdf-thumbs">
          <div className="pdf-thumbs-head">
            <label className="checkbox-row"><input type="checkbox" checked={checked.size === pages.length} onChange={(e) => selectAll(e.target.checked)} /><span>{checked.size ? `${checked.size} selected` : 'Select'}</span></label>
          </div>
          {pages.map((p, i) => (
            <div
              key={p.id}
              className={`pdf-thumb${i === current ? ' active' : ''}${dragPage === i ? ' dragging' : ''}`}
              draggable
              onDragStart={() => setDragPage(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                movePage(dragPage, i);
                setDragPage(null);
              }}
              onDragEnd={() => setDragPage(null)}
              onClick={() => { setCurrent(i); setSelectedAnn(null); }}
            >
              <input
                type="checkbox"
                checked={checked.has(p.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setChecked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })}
              />
              {thumbs.current.get(`${p.id}:${p.rotation}`) ? <img src={thumbs.current.get(`${p.id}:${p.rotation}`)} alt="" /> : <span className="pdf-thumb-loading" />}
              <span className="pdf-thumb-num">{i + 1}{p.annotations.length ? ' ✎' : ''}</span>
            </div>
          ))}
          <button type="button" className="pdf-thumb add" onClick={insertBlank} title="Insert a blank page after the current one">＋ Blank page</button>
        </aside>

        <div className="pdf-center">
          <div className="pdf-tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`photo-tool${tool === t.id ? ' active' : ''}`}
                onClick={() => {
                  setPendingImage(null);
                  if (t.id === 'image') imageRef.current?.click();
                  else if (t.id === 'sign') setShowSign(true);
                  else setTool(t.id);
                }}
                title={t.hint}
              >
                <i className={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
            <button type="button" className="photo-tool" onClick={() => setPexels('annotation')} title="Place a Pexels stock photo on the page">
              <i className="fa-solid fa-camera-retro" />
              <span>Pexels</span>
            </button>
            <span className="pdf-tools-sep" />
            <input type="color" value={style.color} onChange={(e) => setStyle((s) => ({ ...s, color: e.target.value }))} title="Colour" />
            <select className="input input-sm" value={style.size} onChange={(e) => setStyle((s) => ({ ...s, size: Number(e.target.value) }))} title="Text size" style={{ width: 78 }}>
              {[0.012, 0.016, 0.02, 0.022, 0.028, 0.035, 0.045, 0.06, 0.08].map((v) => (
                <option key={v} value={v}>{Math.round(v * 792)}pt</option>
              ))}
            </select>
            <button type="button" className={`btn btn-sm${style.bold ? ' btn-primary' : ''}`} onClick={() => setStyle((s) => ({ ...s, bold: !s.bold }))} title="Bold"><b>B</b></button>
            <select className="input input-sm" value={style.stroke} onChange={(e) => setStyle((s) => ({ ...s, stroke: Number(e.target.value) }))} title="Line width" style={{ width: 92 }}>
              {[0.002, 0.004, 0.007, 0.012].map((v, i) => (
                <option key={v} value={v}>{['Thin', 'Normal', 'Thick', 'Heavy'][i]}</option>
              ))}
            </select>
          </div>
          <div className="pdf-page-actions">
            <span className="task-muted">{checked.size ? `${checked.size} selected pages:` : `Page ${current + 1}:`}</span>
            <button type="button" className="btn btn-sm" onClick={() => rotatePages(-1)} title="Rotate left"><i className="fa-solid fa-rotate-left" /> Left</button>
            <button type="button" className="btn btn-sm" onClick={() => rotatePages(1)} title="Rotate right"><i className="fa-solid fa-rotate-right" /> Right</button>
            <button type="button" className="btn btn-sm" onClick={duplicatePages}>⧉ Duplicate</button>
            <button type="button" className="btn btn-sm" onClick={deletePages}>🗑 Delete</button>
            {checked.size > 0 && <button type="button" className="btn btn-sm" onClick={() => save(true)} disabled={Boolean(busy)}>✂ Extract as new PDF</button>}
            <span className="pdf-zoom">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
              {Math.round(zoom * 100)}%
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>＋</button>
            </span>
          </div>

          <div className="pdf-stage" ref={stageRef}>
            {page && (
              <div className="pdf-page" style={{ width: viewW, height: viewH }}>
                <canvas ref={pageCanvasRef} className="pdf-page-canvas" />
                <div
                  className={`pdf-page-layer tool-${pendingImage ? 'place' : tool}`}
                  onPointerDown={onPageDown}
                  onPointerMove={(e) => { onPageMove(e); onAnnMove(e); }}
                  onPointerUp={() => { onPageUp(); onAnnUp(); }}
                >
                  <svg className="pdf-ink-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    {page.annotations.filter((a) => a.type === 'ink').map((a) => (
                      <polyline
                        key={a.id}
                        points={a.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                        stroke={a.color}
                        strokeWidth={Math.max(1, (a.stroke || 0.004) * viewW)}
                        vectorEffect="non-scaling-stroke"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={a.id === selectedAnn ? 'selected' : ''}
                        onPointerDown={(e) => onAnnDown(e, a)}
                        style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none' }}
                      />
                    ))}
                    {draftView?.tool === 'ink' && (
                      <polyline points={draftView.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')} stroke={style.color} strokeWidth={Math.max(1, style.stroke * viewW)} vectorEffect="non-scaling-stroke" fill="none" strokeLinecap="round" />
                    )}
                  </svg>
                  {page.annotations.filter((a) => a.type !== 'ink').map((a) => (
                    <div
                      key={a.id}
                      className={`pdf-ann pdf-ann-${a.type}${a.id === selectedAnn ? ' selected' : ''}`}
                      style={{
                        left: `${a.x * 100}%`,
                        top: `${a.y * 100}%`,
                        ...(a.type === 'text' ? {} : { width: `${a.w * 100}%`, height: `${a.h * 100}%` }),
                        ...(a.type === 'highlight' ? { background: `${a.color}59` } : {}),
                        ...(a.type === 'rect' ? { border: `${Math.max(1, (a.stroke || 0.004) * viewW)}px solid ${a.color}` } : {}),
                        ...(a.type === 'text' ? { color: a.color, fontSize: layerFont(a), fontWeight: a.bold ? 700 : 400 } : {}),
                        pointerEvents: tool === 'select' || tool === 'text' ? 'auto' : 'none',
                      }}
                      onPointerDown={(e) => onAnnDown(e, a)}
                      onDoubleClick={() => a.type === 'text' && setEditingText(a.id)}
                    >
                      {a.type === 'image' && <img src={a.image} alt="" draggable={false} />}
                      {a.type === 'text' &&
                        (editingText === a.id ? (
                          <textarea
                            autoFocus
                            className="pdf-text-edit"
                            defaultValue={a.text}
                            style={{ fontSize: layerFont(a), color: a.color, fontWeight: a.bold ? 700 : 400 }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              setEditingText(null);
                              const v = e.target.value;
                              if (!v.trim()) deleteAnnotation(a.id);
                              else patchAnnotation(a.id, { text: v });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') e.currentTarget.blur();
                            }}
                            rows={Math.max(1, (a.text || '').split('\n').length)}
                          />
                        ) : (
                          <span style={{ whiteSpace: 'pre' }}>{a.text}</span>
                        ))}
                      {a.id === selectedAnn && a.type !== 'text' && (
                        <span className="pdf-ann-resize" onPointerDown={(e) => onAnnDown(e, a, 'resize')} />
                      )}
                    </div>
                  ))}
                  {draftView && draftView.tool !== 'ink' && (
                    <div
                      className={`pdf-ann pdf-ann-${draftView.tool} draft`}
                      style={{
                        left: `${draftView.x * 100}%`,
                        top: `${draftView.y * 100}%`,
                        width: `${draftView.w * 100}%`,
                        height: `${draftView.h * 100}%`,
                        ...(draftView.tool === 'highlight' ? { background: '#ffe60059' } : {}),
                        ...(draftView.tool === 'rect' ? { border: `2px solid ${style.color}` } : {}),
                      }}
                    />
                  )}
                </div>
              </div>
            )}
            {busy && (
              <div className="photo-busy">
                <span className="photo-spinner" />
                {busy}
              </div>
            )}
          </div>
          <div className="pdf-foot">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>‹ Prev</button>
            <span>Page {current + 1} of {pages.length}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))} disabled={current >= pages.length - 1}>Next ›</button>
            <span className="task-muted">
              {pendingImage ? 'Click the page to place the image.' : TOOLS.find((t) => t.id === tool)?.hint}
              {selected && ' · Delete key removes the selected item.'}
            </span>
            {selected && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => deleteAnnotation(selected.id)}>Remove selected</button>
            )}
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={(e) => { openFiles(e.target.files, 'open'); e.target.value = ''; }} />
      <input ref={mergeRef} type="file" accept="application/pdf,image/*" multiple style={{ display: 'none' }} onChange={(e) => { openFiles(e.target.files, 'append'); e.target.value = ''; }} />
      <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { addImageFile(e.target.files?.[0]); e.target.value = ''; }} />
      {showSign && (
        <SignaturePad
          onClose={() => setShowSign(false)}
          onDone={(src, ratio) => {
            setShowSign(false);
            setPendingImage({ src, ratio });
            setNotice('Click on the page to place your signature, then drag its corner to resize.');
          }}
        />
      )}
      {pexels && (
        <PexelsPicker
          multiple={pexels === 'pages'}
          max={30}
          title={pexels === 'pages' ? 'Add Pexels photos as pages' : 'Place a Pexels photo'}
          onPick={(photos) => addPexels(photos, pexels)}
          onClose={() => setPexels(null)}
        />
      )}
      {showSave && (
        <div className="modal-overlay" onClick={() => setShowSave(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-track-head">
              <h2>Save PDF</h2>
              <button type="button" className="new-track-close" onClick={() => setShowSave(false)}>×</button>
            </div>
            <div className="field-group">
              <label className="field-label">Page numbers</label>
              <select className="input" value={saveOpts.pageNumbers} onChange={(e) => setSaveOpts((o) => ({ ...o, pageNumbers: e.target.value }))}>
                <option value="">None</option>
                <option value="n">1, 2, 3…</option>
                <option value="n-of-total">Page 1 of {pages.length}</option>
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Watermark (optional)</label>
              <input className="input" placeholder="e.g. CONFIDENTIAL, DRAFT, COPY" value={saveOpts.watermark} onChange={(e) => setSaveOpts((o) => ({ ...o, watermark: e.target.value }))} />
            </div>
            <div className="field-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">Title</label>
                <input className="input" value={saveOpts.title} onChange={(e) => setSaveOpts((o) => ({ ...o, title: e.target.value }))} placeholder={fileName} />
              </div>
              <div>
                <label className="field-label">Author</label>
                <input className="input" value={saveOpts.author} onChange={(e) => setSaveOpts((o) => ({ ...o, author: e.target.value }))} />
              </div>
            </div>
            <p className="field-hint">White-out covers content visually; the text underneath may still be selectable in the file. Don’t rely on it to remove sensitive data.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowSave(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={Boolean(busy)}>{busy ? 'Building…' : `Download ${pages.length}-page PDF`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
