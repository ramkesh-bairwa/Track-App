'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ADJUST,
  ADJUST_GROUPS,
  HSL_COLORS,
  applyAdjustments,
  autoLevels,
  meanLuminance,
  denoise,
  unsharpMask,
  upscaleCanvas,
  resizeCanvas,
  rotateCanvas,
  straightenCanvas,
  flipCanvas,
  cropCanvas,
  cloneCanvas,
  makeCanvas,
} from '@/lib/imageOps';
import {
  EFFECTS,
  FILTER_LIBRARY,
  FILTER_GROUPS,
  FRAMES,
  FONTS,
  STICKERS,
  SIZE_PRESETS,
  BRUSH_TOOLS,
  applyEffectToCanvas,
  applyFrame,
  drawTextOnCanvas,
  brushSource,
  filterSwatchStyle,
} from '@/lib/imageEffects';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import PexelsPicker, { loadPexelsImage } from '@/components/photo/PexelsPicker';
import { safeLink } from '@/lib/safeUrl';

const PREVIEW_MAX = 1400; // live preview is rendered at most this big
const MAX_SIDE = 8192; // browsers struggle with canvases larger than this
const MAX_PIXELS = 40_000_000;
const HISTORY_LIMIT = 25;

// Everything the editor offers, counted honestly (each is its own control).
export const TOOL_COUNT =
  ADJUST_GROUPS.reduce((n, g) => n + g.items.length, 0) +
  HSL_COLORS.length * 3 + 5 + 3 + 2 + // colour mixer, split toning, channels, B&W modes
  FILTER_LIBRARY.length + EFFECTS.length + FRAMES.length + STICKERS.length + FONTS.length +
  SIZE_PRESETS.length + BRUSH_TOOLS.length + 7 + 4 + 5 + 4; // crop ratios, rotate/flip, enhance tools, upscales

const TABS = [
  { key: 'enhance', label: 'Enhance', icon: 'fa-solid fa-wand-magic-sparkles' },
  { key: 'adjust', label: 'Adjust', icon: 'fa-solid fa-sliders' },
  { key: 'color', label: 'Colour', icon: 'fa-solid fa-droplet' },
  { key: 'filters', label: 'Filters', icon: 'fa-solid fa-palette' },
  { key: 'effects', label: 'Effects', icon: 'fa-solid fa-star' },
  { key: 'draw', label: 'Draw', icon: 'fa-solid fa-paintbrush' },
  { key: 'text', label: 'Text', icon: 'fa-solid fa-font' },
  { key: 'frames', label: 'Frames', icon: 'fa-regular fa-square' },
  { key: 'transform', label: 'Crop & size', icon: 'fa-solid fa-crop-simple' },
  { key: 'export', label: 'Save', icon: 'fa-solid fa-download' },
];

const ASPECTS = [
  { id: 'free', label: 'Free', r: null },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '3:2', label: '3:2', r: 3 / 2 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '3:4', label: '3:4', r: 3 / 4 },
  { id: '9:16', label: '9:16', r: 9 / 16 },
];

const tick = () => new Promise((r) => setTimeout(r, 30)); // let "Working…" paint

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be opened as an image.'));
    };
    img.src = url;
  });
}

function fitRect(aspect, imgW, imgH) {
  // Largest centered crop of the given aspect (in 0..1 image fractions).
  if (!aspect) return { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  const imgAspect = imgW / imgH;
  let w = 1;
  let h = 1;
  if (aspect > imgAspect) h = imgAspect / aspect;
  else w = aspect / imgAspect;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const DEFAULT_TEXT = {
  text: 'Your text',
  font: 'IBM Plex Sans',
  size: 0.08,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  strokeWidth: 0,
  strokeColor: '#000000',
  shadow: true,
  background: '',
};

export default function PhotoEditor({ incoming, onIncomingUsed, active = true }) {
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  const originalRef = useRef(null);
  const renderReq = useRef(0);
  const strokeRef = useRef(null); // { canvas, source, last } while painting

  const [history, setHistory] = useState([]); // [{ canvas, adjust, label }]
  const [index, setIndex] = useState(-1);
  const [adjust, setAdjust] = useState(DEFAULT_ADJUST);
  const [preset, setPreset] = useState('none');
  const [presetStrength, setPresetStrength] = useState(100);
  const [filterGroup, setFilterGroup] = useState('Basic');
  const [effect, setEffect] = useState(null); // { id, amount } live preview
  const [tab, setTab] = useState('enhance');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(false);
  const [fileName, setFileName] = useState('photo');
  const [dragging, setDragging] = useState(false);
  const [crop, setCrop] = useState(null); // { aspect, rect, target? } while cropping
  const [straighten, setStraighten] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0, lock: true });
  const [format, setFormat] = useState('image/jpeg');
  const [quality, setQuality] = useState(92);
  const [pexels, setPexels] = useState(false);
  const [credit, setCredit] = useState(null);
  const [brush, setBrush] = useState({ tool: 'brush', color: '#ff3b6b', size: 30, opacity: 90 });
  const [strokeView, setStrokeView] = useState(null); // canvas shown while a stroke is in progress
  const [text, setText] = useState(DEFAULT_TEXT);
  const [sticker, setSticker] = useState({ emoji: '', size: 0.15 });
  const [frame, setFrame] = useState({ id: 'border', color: '#ffffff', size: 40 });

  const current = history[index] || null;
  const base = current?.canvas || null;

  // ---------- history ----------
  const push = useCallback(
    (canvas, nextAdjust, label) => {
      setHistory((h) => {
        const trimmed = h.slice(0, index + 1);
        const next = [...trimmed, { canvas, adjust: nextAdjust, label }];
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
      });
      setIndex((i) => Math.min(i + 1, HISTORY_LIMIT - 1));
      setAdjust(nextAdjust);
    },
    [index]
  );

  function undo() {
    if (index <= 0) return;
    setIndex(index - 1);
    setAdjust(history[index - 1].adjust);
  }
  function redo() {
    if (index >= history.length - 1) return;
    setIndex(index + 1);
    setAdjust(history[index + 1].adjust);
  }

  // Slider changes land in history once they settle, not on every pixel.
  useEffect(() => {
    if (!current || current.adjust === adjust) return undefined;
    const t = setTimeout(() => push(current.canvas, adjust, 'Adjust'), 700);
    return () => clearTimeout(t);
  }, [adjust, current, push]);

  useEffect(() => {
    if (base) setSize((s) => ({ ...s, w: base.width, h: base.height }));
  }, [base]);

  // ---------- rendering ----------
  const render = useCallback(() => {
    const out = previewRef.current;
    const src = compare ? originalRef.current : strokeView || base;
    if (!out || !src) return;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    if (out.width !== w) out.width = w;
    if (out.height !== h) out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    if (!compare) {
      const img = ctx.getImageData(0, 0, w, h);
      // Same order as when baked: effect first, then the sliders.
      if (!strokeView) {
        // The stroke canvas already has the look baked in (see flattened()).
        const fx = effect && EFFECTS.find((e) => e.id === effect.id);
        if (fx) fx.apply(img, effect.amount);
        applyAdjustments(img, adjust);
      }
      ctx.putImageData(img, 0, 0);
    }
  }, [base, adjust, compare, effect, strokeView]);

  useEffect(() => {
    cancelAnimationFrame(renderReq.current);
    renderReq.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(renderReq.current);
  }, [render]);

  // ---------- loading ----------
  function openImage(img, name) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const shrink = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.round(w * shrink);
    h = Math.round(h * shrink);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    originalRef.current = cloneCanvas(c);
    setHistory([{ canvas: c, adjust: DEFAULT_ADJUST, label: 'Open' }]);
    setIndex(0);
    setAdjust(DEFAULT_ADJUST);
    setPreset('none');
    setEffect(null);
    setCrop(null);
    setStraighten(0);
    setFileName(name || 'photo');
    if (shrink < 1) setError(`That image was very large, so it was opened at ${w}×${h}.`);
  }

  async function openFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPG, PNG, WEBP or GIF).');
      return;
    }
    setError('');
    setBusy('Opening…');
    try {
      const img = await loadImageFile(file);
      openImage(img, file.name.replace(/\.[^.]+$/, ''));
      setCredit(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function openPexels(photo) {
    setBusy('Downloading from Pexels…');
    setError('');
    try {
      const img = await loadPexelsImage(photo);
      openImage(img, `pexels-${photo.id}`);
      setCredit({ name: photo.photographer, url: photo.url });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  // A canvas handed over from the collage maker.
  useEffect(() => {
    if (!incoming) return;
    openImage(incoming.canvas, incoming.name || 'collage');
    setCredit(null);
    onIncomingUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  useEffect(() => {
    if (!active) return undefined; // hidden tab in the studio — don't grab paste/undo
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) openFile(item.getAsFile());
    }
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  });

  // ---------- destructive ("baked") operations ----------
  // Bakes the live look (effect preview + sliders) into the pixels and resets
  // them, so things added on top — frames, text, stickers, brush strokes —
  // keep exactly the colours you picked instead of being re-filtered.
  function flattened() {
    let c = base;
    if (effect) c = applyEffectToCanvas(c, EFFECTS.find((e) => e.id === effect.id), effect.amount);
    const plain = JSON.stringify(adjust) === JSON.stringify(DEFAULT_ADJUST);
    return plain ? c : withPixels(c, (img) => applyAdjustments(img, adjust));
  }

  async function bake(label, fn, nextAdjust = adjust, { overlay = false } = {}) {
    if (!base) return;
    setBusy(`${label}…`);
    setError('');
    await tick();
    try {
      const out = await fn(overlay ? flattened() : base);
      if (overlay) {
        setEffect(null);
        setPreset('none');
      }
      push(out, overlay ? DEFAULT_ADJUST : nextAdjust, label);
    } catch (err) {
      setError(err.message || `${label} failed.`);
    } finally {
      setBusy('');
    }
  }

  function withPixels(src, op) {
    const c = cloneCanvas(src);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, c.width, c.height);
    op(img);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function safeFactor(src, factor) {
    const byside = MAX_SIDE / Math.max(src.width, src.height);
    const bypx = Math.sqrt(MAX_PIXELS / (src.width * src.height));
    return Math.min(factor, byside, bypx);
  }

  function upscale(factor) {
    const fct = safeFactor(base, factor);
    if (fct < 1.05) {
      setError(`This image is already ${base.width}×${base.height} — too large to upscale further in the browser.`);
      return;
    }
    bake(`Upscale ${fct < factor ? fct.toFixed(1) : factor}×`, (src) => upscaleCanvas(src, fct));
  }

  function autoEnhance() {
    const lum = (() => {
      const c = makeCanvas(Math.min(400, base.width), Math.min(400, base.height));
      c.getContext('2d').drawImage(base, 0, 0, c.width, c.height);
      return meanLuminance(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    })();
    const next = {
      ...adjust,
      exposure: lum < 0.35 ? 18 : lum > 0.7 ? -8 : adjust.exposure,
      shadows: Math.max(adjust.shadows, lum < 0.45 ? 30 : 15),
      highlights: Math.min(adjust.highlights, -15),
      vibrance: Math.max(adjust.vibrance, 20),
      clarity: Math.max(adjust.clarity, 15),
      sharpness: Math.max(adjust.sharpness, 20),
    };
    bake('Auto enhance', (src) => withPixels(src, (img) => autoLevels(img)), next);
  }

  // One click "low quality → high quality": clean noise, enlarge small
  // photos toward ~2400px, fix levels, then crisp up details.
  function enhanceHD() {
    const longSide = Math.max(base.width, base.height);
    const factor = longSide < 2400 ? safeFactor(base, Math.min(4, 2400 / longSide)) : 1;
    bake('Enhance to HD', (src) => {
      let c = withPixels(src, (img) => denoise(img, 30));
      if (factor > 1.05) c = upscaleCanvas(c, factor);
      return withPixels(c, (img) => {
        autoLevels(img, 0.003);
        unsharpMask(img, 0.5, 2, 2);
      });
    }, { ...adjust, vibrance: Math.max(adjust.vibrance, 15), clarity: Math.max(adjust.clarity, 20), shadows: Math.max(adjust.shadows, 10) });
  }

  function applyPreset(p, strength = presetStrength) {
    setPreset(p.id);
    const k = strength / 100;
    const next = { ...DEFAULT_ADJUST };
    for (const [key, value] of Object.entries(p.adjust)) {
      // Hue angles and colours aren't "amounts", so strength leaves them alone.
      const isAmount = typeof value === 'number' && !/Hue$/.test(key);
      next[key] = isAmount ? Math.round(value * k) : value;
    }
    setAdjust(next);
  }

  function applyEffect() {
    const fx = EFFECTS.find((e) => e.id === effect.id);
    const amount = effect.amount;
    setEffect(null);
    bake(fx.label, (src) => applyEffectToCanvas(src, fx, amount));
  }

  // ---------- pointer → image coordinates ----------
  function pointerFrac(e) {
    const r = previewRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  // ---------- crop interaction ----------
  const dragRef = useRef(null);
  function startCrop(aspectId = 'free', r = null, target = null) {
    const a = r ?? ASPECTS.find((x) => x.id === aspectId)?.r ?? null;
    setCrop({ aspect: aspectId, ratio: a, rect: fitRect(a, base.width, base.height), target });
  }

  function onCropDown(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, start: pointerFrac(e), rect: crop.rect };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onCropMove(e) {
    const d = dragRef.current;
    if (!d || !crop) return;
    const p = pointerFrac(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const r = { ...d.rect };
    const aspect = crop.ratio;
    const imgAspect = base.width / base.height;
    if (d.mode === 'move') {
      r.x = Math.min(1 - r.w, Math.max(0, d.rect.x + dx));
      r.y = Math.min(1 - r.h, Math.max(0, d.rect.y + dy));
    } else {
      const left = d.mode.includes('w');
      const top = d.mode.includes('n');
      let x1 = left ? d.rect.x + dx : d.rect.x;
      let x2 = left ? d.rect.x + d.rect.w : d.rect.x + d.rect.w + dx;
      let y1 = top ? d.rect.y + dy : d.rect.y;
      let y2 = top ? d.rect.y + d.rect.h : d.rect.y + d.rect.h + dy;
      x1 = Math.max(0, Math.min(x1, x2 - 0.03));
      x2 = Math.min(1, Math.max(x2, x1 + 0.03));
      y1 = Math.max(0, Math.min(y1, y2 - 0.03));
      y2 = Math.min(1, Math.max(y2, y1 + 0.03));
      r.x = x1;
      r.y = y1;
      r.w = x2 - x1;
      r.h = y2 - y1;
      if (aspect) {
        const hFrac = (r.w * imgAspect) / aspect;
        if (top) r.y = Math.max(0, y2 - hFrac);
        r.h = Math.min(hFrac, top ? y2 : 1 - r.y);
        r.w = (r.h * aspect) / imgAspect;
        if (left) r.x = x2 - r.w;
      }
    }
    setCrop((c) => ({ ...c, rect: r }));
  }

  function applyCrop() {
    const { rect, target } = crop;
    setCrop(null);
    bake(target ? `Crop to ${target.label}` : 'Crop', (src) => {
      const c = cropCanvas(src, rect);
      return target ? resizeCanvas(c, target.w, target.h) : c;
    });
  }

  function applyResize() {
    const w = Math.round(Number(size.w));
    const h = Math.round(Number(size.h));
    if (!(w > 0 && h > 0)) return setError('Enter a width and height.');
    if (Math.max(w, h) > MAX_SIDE || w * h > MAX_PIXELS) return setError(`Keep it under ${MAX_SIDE}px per side.`);
    bake(`Resize to ${w}×${h}`, (src) => resizeCanvas(src, w, h));
  }

  // ---------- drawing (brushes) ----------
  function paintAt(stroke, fx, fy) {
    const { canvas, source } = stroke;
    const ctx = canvas.getContext('2d');
    const x = fx * canvas.width;
    const y = fy * canvas.height;
    const radius = (brush.size / 1000) * Math.max(canvas.width, canvas.height);
    const from = stroke.last || { x, y };
    const dist = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius / 3)));
    ctx.save();
    ctx.globalAlpha = (brush.opacity / 100) * (brush.tool === 'brush' || brush.tool === 'eraser' ? 1 : 0.35);
    if (brush.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    for (let s = 1; s <= steps; s++) {
      const px = from.x + ((x - from.x) * s) / steps;
      const py = from.y + ((y - from.y) * s) / steps;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.clip();
      if (brush.tool === 'eraser') ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      else ctx.drawImage(source, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    stroke.last = { x, y };
  }

  function onDrawDown(e) {
    if (!base) return;
    e.preventDefault();
    const p = pointerFrac(e);
    if (brush.tool === 'picker') {
      const c = previewRef.current;
      const px = c.getContext('2d').getImageData(Math.floor(p.x * (c.width - 1)), Math.floor(p.y * (c.height - 1)), 1, 1).data;
      const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      setBrush((b) => ({ ...b, color: hex, tool: 'brush' }));
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const flat = flattened();
    const stroke = { canvas: cloneCanvas(flat), source: brushSource(flat, brush.tool, brush.color), last: null };
    strokeRef.current = stroke;
    paintAt(stroke, p.x, p.y);
    setStrokeView(stroke.canvas);
    renderReq.current = requestAnimationFrame(render);
  }

  function onDrawMove(e) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const p = pointerFrac(e);
    paintAt(stroke, p.x, p.y);
    cancelAnimationFrame(renderReq.current);
    renderReq.current = requestAnimationFrame(render);
  }

  function onDrawUp() {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    setStrokeView(null);
    const label = BRUSH_TOOLS.find((t) => t.id === brush.tool)?.label || 'Draw';
    setEffect(null);
    setPreset('none');
    push(stroke.canvas, DEFAULT_ADJUST, `${label} stroke`);
  }

  // ---------- text & stickers ----------
  function placeText(fx = 0.5, fy = 0.5) {
    if (!text.text.trim()) return setError('Type some text first.');
    bake('Add text', (src) => drawTextOnCanvas(src, { ...text, x: fx, y: fy }), adjust, { overlay: true });
  }
  function placeSticker(fx = 0.5, fy = 0.5) {
    if (!sticker.emoji) return;
    bake('Add sticker', (src) =>
      drawTextOnCanvas(src, { text: sticker.emoji, font: 'Apple Color Emoji', size: sticker.size, color: '#000', x: fx, y: fy, align: 'center', bold: false }),
      adjust,
      { overlay: true }
    );
  }
  function onPlaceClick(e) {
    const p = pointerFrac(e);
    if (sticker.emoji) placeSticker(p.x, p.y);
    else placeText(p.x, p.y);
  }

  // ---------- export ----------
  async function renderFull() {
    let c = base;
    if (effect) c = applyEffectToCanvas(c, EFFECTS.find((e) => e.id === effect.id), effect.amount);
    return withPixels(c, (img) => applyAdjustments(img, adjust));
  }

  async function download() {
    if (!base) return;
    setBusy('Preparing download…');
    await tick();
    try {
      const c = await renderFull();
      let out = c;
      if (format === 'image/jpeg') {
        // JPEG has no transparency — flatten onto white instead of black.
        out = makeCanvas(c.width, c.height);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(c, 0, 0);
      }
      const blob = await new Promise((resolve) => out.toBlob(resolve, format, quality / 100));
      if (!blob) throw new Error('Your browser could not encode that format.');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[format];
      downloadBlob(blob, `${safeFilename(fileName, 'photo')}-edited.${ext}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function downloadPdf() {
    setBusy('Making PDF…');
    await tick();
    try {
      const c = await renderFull();
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      const jpg = await new Promise((r) => {
        const flat = makeCanvas(c.width, c.height);
        const ctx = flat.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, flat.width, flat.height);
        ctx.drawImage(c, 0, 0);
        flat.toBlob(r, 'image/jpeg', 0.92);
      });
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      const page = doc.addPage([img.width * 0.75, img.height * 0.75]);
      page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      downloadBlob(new Blob([await doc.save()], { type: 'application/pdf' }), `${safeFilename(fileName, 'photo')}.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const changed = JSON.stringify(adjust) !== JSON.stringify(DEFAULT_ADJUST);

  // ---------- UI ----------
  if (!base) {
    return (
      <>
        <div
          className={`photo-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            openFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
        >
          <i className="fa-solid fa-image" />
          <strong>{busy || 'Drop a photo here, or click to choose one'}</strong>
          <span>JPG, PNG, WEBP or GIF · you can also paste an image (Ctrl/⌘+V) · {TOOL_COUNT}+ editing tools</span>
        </div>
        <div className="photo-drop-alt">
          <span className="task-muted">No photo handy?</span>
          <button type="button" className="btn" onClick={() => setPexels(true)}>
            <i className="fa-solid fa-camera-retro" /> Pick a free stock photo from Pexels
          </button>
        </div>
        {error && <div className="top-error" style={{ marginTop: 12 }}>{error}</div>}
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
        {pexels && <PexelsPicker onPick={([p]) => openPexels(p)} onClose={() => setPexels(false)} />}
      </>
    );
  }

  const slider = (key, label, min, max, step = 1) => (
    <label key={key} className="photo-slider">
      <span className="photo-slider-head">
        <span>{label}</span>
        <button type="button" className="photo-slider-value" onClick={() => setAdjust((a) => ({ ...a, [key]: DEFAULT_ADJUST[key] }))} title="Reset">
          {adjust[key] > 0 && min < 0 ? `+${adjust[key]}` : adjust[key]}
        </button>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={adjust[key]}
        onChange={(e) => setAdjust((a) => ({ ...a, [key]: Number(e.target.value) }))}
        onDoubleClick={() => setAdjust((a) => ({ ...a, [key]: DEFAULT_ADJUST[key] }))}
      />
    </label>
  );

  const drawing = tab === 'draw' && !crop && !compare;
  const placing = tab === 'text' && !crop && !compare;

  return (
    <div className="photo-editor">
      <div className="photo-toolbar">
        <input className="input input-sm photo-name" value={fileName} onChange={(e) => setFileName(e.target.value)} aria-label="File name" />
        <span className="task-muted photo-dims">{base.width} × {base.height}px</span>
        {credit && (
          <a className="photo-credit" href={safeLink(credit.url) || undefined} target="_blank" rel="noreferrer">Photo by {credit.name} on Pexels</a>
        )}
        <div className="photo-toolbar-actions">
          <button type="button" className="btn btn-sm" onClick={undo} disabled={index <= 0 || Boolean(busy)} title="Undo (Ctrl/⌘+Z)">↶ Undo</button>
          <button type="button" className="btn btn-sm" onClick={redo} disabled={index >= history.length - 1 || Boolean(busy)} title="Redo (Ctrl/⌘+Shift+Z)">↷ Redo</button>
          <button
            type="button"
            className={`btn btn-sm${compare ? ' btn-primary' : ''}`}
            onPointerDown={() => setCompare(true)}
            onPointerUp={() => setCompare(false)}
            onPointerLeave={() => setCompare(false)}
            title="Hold to see the original"
          >
            ◐ Hold for original
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              push(cloneCanvas(originalRef.current), DEFAULT_ADJUST, 'Reset');
              setPreset('none');
              setEffect(null);
            }}
            disabled={Boolean(busy)}
          >
            Reset all
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>Open…</button>
          <button type="button" className="btn btn-sm" onClick={() => setPexels(true)} title="Free stock photos">
            <i className="fa-solid fa-camera-retro" /> Pexels
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={download} disabled={Boolean(busy)}>⬇ Download</button>
        </div>
      </div>
      {error && <div className="top-error">{error}</div>}

      <div className="photo-main">
        <div
          className="photo-stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            openFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="photo-canvas-wrap">
            <canvas ref={previewRef} className="photo-canvas" />
            {drawing && (
              <div
                className={`photo-draw-layer tool-${brush.tool}`}
                onPointerDown={onDrawDown}
                onPointerMove={onDrawMove}
                onPointerUp={onDrawUp}
                onPointerCancel={onDrawUp}
              />
            )}
            {placing && <div className="photo-place-layer" onClick={onPlaceClick} title={sticker.emoji ? 'Click to place the sticker' : 'Click to place the text'} />}
            {crop && !compare && (
              <div className="photo-crop-layer" onPointerMove={onCropMove} onPointerUp={() => (dragRef.current = null)} onPointerCancel={() => (dragRef.current = null)}>
                <div
                  className="photo-crop-rect"
                  style={{ left: `${crop.rect.x * 100}%`, top: `${crop.rect.y * 100}%`, width: `${crop.rect.w * 100}%`, height: `${crop.rect.h * 100}%` }}
                  onPointerDown={(e) => onCropDown(e, 'move')}
                >
                  <span className="photo-crop-grid" />
                  {['nw', 'ne', 'sw', 'se'].map((h) => (
                    <span key={h} className={`photo-crop-handle ${h}`} onPointerDown={(e) => onCropDown(e, h)} />
                  ))}
                  <span className="photo-crop-size">
                    {crop.target ? `${crop.target.w} × ${crop.target.h}` : `${Math.round(crop.rect.w * base.width)} × ${Math.round(crop.rect.h * base.height)}`}
                  </span>
                </div>
              </div>
            )}
          </div>
          {compare && <span className="photo-badge">Original</span>}
          {effect && !compare && <span className="photo-badge">Previewing: {EFFECTS.find((e) => e.id === effect.id)?.label}</span>}
          {busy && (
            <div className="photo-busy">
              <span className="photo-spinner" />
              {busy}
            </div>
          )}
        </div>

        <aside className="photo-panel">
          <div className="photo-tabs">
            {TABS.map((t) => (
              <button key={t.key} type="button" className={`photo-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                <i className={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="photo-panel-body">
            {tab === 'enhance' && (
              <>
                <button type="button" className="photo-big-btn primary" onClick={enhanceHD} disabled={Boolean(busy)}>
                  <i className="fa-solid fa-gem" />
                  <span>
                    <strong>Enhance to HD</strong>
                    <small>Cleans noise, enlarges small photos to ~2400px, fixes light and sharpens detail.</small>
                  </span>
                </button>
                <button type="button" className="photo-big-btn" onClick={autoEnhance} disabled={Boolean(busy)}>
                  <i className="fa-solid fa-wand-magic-sparkles" />
                  <span>
                    <strong>Auto enhance</strong>
                    <small>Balances exposure, colour and contrast automatically.</small>
                  </span>
                </button>
                <div className="photo-section-label">Upscale (make bigger)</div>
                <div className="photo-btn-row">
                  {[1.5, 2, 3, 4].map((fct) => (
                    <button key={fct} type="button" className="btn btn-sm" onClick={() => upscale(fct)} disabled={Boolean(busy)}>
                      {fct}×
                    </button>
                  ))}
                </div>
                <div className="photo-section-label">Quick fixes</div>
                <div className="photo-btn-row wrap">
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Remove noise', (s) => withPixels(s, (img) => denoise(img, 55)))}>Remove noise</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Sharpen', (s) => withPixels(s, (img) => unsharpMask(img, 0.8, 1, 2)))}>Sharpen details</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Fix colours', (s) => withPixels(s, (img) => autoLevels(img)))}>Fix colours</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => setAdjust((a) => ({ ...a, shadows: 40, highlights: -20, exposure: Math.max(a.exposure, 10) }))}>Brighten dark photo</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => setAdjust((a) => ({ ...a, denoise: 35, clarity: -15, warmth: 8, exposure: Math.max(a.exposure, 5) }))}>Smooth skin</button>
                </div>
                <p className="field-hint">
                  {TOOL_COUNT} editing tools across the tabs above. Upscaling uses high-quality resampling plus sharpening — it makes photos
                  larger and crisper, but can’t invent detail that isn’t in the photo the way AI upscalers do.
                </p>
              </>
            )}

            {tab === 'adjust' && (
              <>
                {ADJUST_GROUPS.map((g) => (
                  <div key={g.label}>
                    <div className="photo-section-label">{g.label}</div>
                    {g.items.map(([key, label, min, max]) => slider(key, label, min, max))}
                  </div>
                ))}
                <div className="photo-section-label">Black &amp; white</div>
                <div className="photo-btn-row">
                  {[
                    ['none', 'Colour'],
                    ['grayscale', 'Grayscale'],
                    ['sepia', 'Sepia'],
                  ].map(([id, label]) => (
                    <button key={id} type="button" className={`btn btn-sm${adjust.mono === id ? ' btn-primary' : ''}`} onClick={() => setAdjust((a) => ({ ...a, mono: id }))}>
                      {label}
                    </button>
                  ))}
                </div>
                {changed && (
                  <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 12 }} onClick={() => { setAdjust(DEFAULT_ADJUST); setPreset('none'); }}>
                    Reset adjustments
                  </button>
                )}
              </>
            )}

            {tab === 'color' && (
              <>
                <div className="photo-section-label">Colour mixer (per colour)</div>
                {HSL_COLORS.map((c) => (
                  <details key={c.id} className="photo-hsl">
                    <summary>
                      <span className="photo-hsl-dot" style={{ background: c.swatch }} />
                      {c.label}
                      {(adjust[`hsl_${c.id}_h`] || adjust[`hsl_${c.id}_s`] || adjust[`hsl_${c.id}_l`]) ? <span className="photo-hsl-on">edited</span> : null}
                    </summary>
                    {slider(`hsl_${c.id}_h`, 'Hue', -100, 100)}
                    {slider(`hsl_${c.id}_s`, 'Saturation', -100, 100)}
                    {slider(`hsl_${c.id}_l`, 'Luminance', -100, 100)}
                  </details>
                ))}
                <div className="photo-section-label">Split toning</div>
                {slider('splitHighHue', 'Highlights hue', 0, 360)}
                {slider('splitHighSat', 'Highlights amount', 0, 100)}
                {slider('splitShadowHue', 'Shadows hue', 0, 360)}
                {slider('splitShadowSat', 'Shadows amount', 0, 100)}
                {slider('splitBalance', 'Balance', -100, 100)}
                <div className="photo-section-label">Channel mixer</div>
                {slider('red', 'Red', -100, 100)}
                {slider('green', 'Green', -100, 100)}
                {slider('blue', 'Blue', -100, 100)}
                <div className="photo-section-label">Colour overlay</div>
                <div className="photo-color-row">
                  <input type="color" value={adjust.overlayColor || '#ff8a5b'} onChange={(e) => setAdjust((a) => ({ ...a, overlayColor: e.target.value, overlayAmount: a.overlayAmount || 30 }))} />
                  {slider('overlayAmount', 'Amount', 0, 100)}
                </div>
                <div className="photo-section-label">Duotone</div>
                <div className="photo-color-row">
                  <input type="color" value={adjust.duotoneDark || '#0b1d51'} onChange={(e) => setAdjust((a) => ({ ...a, duotoneDark: e.target.value, duotoneLight: a.duotoneLight || '#ffcf6b', duotoneAmount: a.duotoneAmount || 100 }))} title="Dark colour" />
                  <input type="color" value={adjust.duotoneLight || '#ffcf6b'} onChange={(e) => setAdjust((a) => ({ ...a, duotoneLight: e.target.value, duotoneDark: a.duotoneDark || '#0b1d51', duotoneAmount: a.duotoneAmount || 100 }))} title="Light colour" />
                  {slider('duotoneAmount', 'Amount', 0, 100)}
                </div>
              </>
            )}

            {tab === 'filters' && (
              <>
                <div className="photo-chip-row">
                  {FILTER_GROUPS.map((g) => (
                    <button key={g} type="button" className={`new-track-group${filterGroup === g ? ' active' : ''}`} onClick={() => setFilterGroup(g)}>
                      {g} <span className="task-muted">{FILTER_LIBRARY.filter((p) => p.group === g).length}</span>
                    </button>
                  ))}
                </div>
                <div className="photo-filters">
                  {FILTER_LIBRARY.filter((p) => p.group === filterGroup).map((p) => (
                    <button key={p.id} type="button" className={`photo-filter${preset === p.id ? ' active' : ''}`} onClick={() => applyPreset(p)}>
                      <span className="photo-filter-swatch" style={filterSwatchStyle(p)} />
                      {p.label}
                    </button>
                  ))}
                </div>
                {preset !== 'none' && (
                  <label className="photo-slider" style={{ marginTop: 14 }}>
                    <span className="photo-slider-head"><span>Filter strength</span><span className="photo-slider-value">{presetStrength}%</span></span>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      value={presetStrength}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setPresetStrength(v);
                        applyPreset(FILTER_LIBRARY.find((p) => p.id === preset), v);
                      }}
                    />
                  </label>
                )}
                <p className="field-hint">{FILTER_LIBRARY.length} filters. A filter sets the sliders in Adjust and Colour — fine-tune it there.</p>
              </>
            )}

            {tab === 'effects' && (
              <>
                {effect && (
                  <div className="photo-effect-live">
                    <label className="photo-slider">
                      <span className="photo-slider-head">
                        <span>{EFFECTS.find((e) => e.id === effect.id)?.label} strength</span>
                        <span className="photo-slider-value">{effect.amount}</span>
                      </span>
                      <input type="range" min={1} max={100} value={effect.amount} onChange={(e) => setEffect((x) => ({ ...x, amount: Number(e.target.value) }))} />
                    </label>
                    <div className="photo-btn-row">
                      <button type="button" className="btn btn-sm btn-primary" onClick={applyEffect} disabled={Boolean(busy)}>✓ Apply</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEffect(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {[...new Set(EFFECTS.map((e) => e.group))].map((g) => (
                  <div key={g}>
                    <div className="photo-section-label">{g}</div>
                    <div className="photo-btn-row wrap">
                      {EFFECTS.filter((e) => e.group === g).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className={`btn btn-sm${effect?.id === e.id ? ' btn-primary' : ''}`}
                          onClick={() => setEffect({ id: e.id, amount: e.def })}
                          disabled={Boolean(busy)}
                        >
                          {e.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="field-hint">Pick an effect to preview it live, adjust its strength, then Apply.</p>
              </>
            )}

            {tab === 'draw' && (
              <>
                <div className="photo-tool-grid">
                  {BRUSH_TOOLS.map((t) => (
                    <button key={t.id} type="button" className={`photo-tool${brush.tool === t.id ? ' active' : ''}`} onClick={() => setBrush((b) => ({ ...b, tool: t.id }))}>
                      <i className={t.icon} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                {brush.tool === 'brush' && (
                  <div className="photo-color-row" style={{ marginTop: 10 }}>
                    <input type="color" value={brush.color} onChange={(e) => setBrush((b) => ({ ...b, color: e.target.value }))} />
                    <div className="photo-swatches">
                      {['#ffffff', '#000000', '#ff3b6b', '#ffb020', '#ffe14d', '#35c2a6', '#4fa6e8', '#6c7bff', '#b47fe8'].map((c) => (
                        <button key={c} type="button" style={{ background: c }} onClick={() => setBrush((b) => ({ ...b, color: c }))} title={c} />
                      ))}
                    </div>
                  </div>
                )}
                <label className="photo-slider" style={{ marginTop: 10 }}>
                  <span className="photo-slider-head"><span>Brush size</span><span className="photo-slider-value">{brush.size}</span></span>
                  <input type="range" min={2} max={150} value={brush.size} onChange={(e) => setBrush((b) => ({ ...b, size: Number(e.target.value) }))} />
                </label>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Strength</span><span className="photo-slider-value">{brush.opacity}%</span></span>
                  <input type="range" min={5} max={100} value={brush.opacity} onChange={(e) => setBrush((b) => ({ ...b, opacity: Number(e.target.value) }))} />
                </label>
                <p className="field-hint">
                  Paint straight on the photo. Blur and Pixelate are handy for hiding faces or number plates; Lighten / Darken work like dodge &amp; burn.
                  Erase makes areas transparent (save as PNG to keep it). Each stroke can be undone.
                </p>
              </>
            )}

            {tab === 'text' && (
              <>
                <div className="photo-section-label">Text</div>
                <textarea className="input" rows={2} value={text.text} onChange={(e) => { setText((t) => ({ ...t, text: e.target.value })); setSticker((s) => ({ ...s, emoji: '' })); }} />
                <div className="photo-text-grid">
                  <select className="input input-sm" value={text.font} onChange={(e) => setText((t) => ({ ...t, font: e.target.value }))} style={{ fontFamily: text.font }}>
                    {FONTS.map((fo) => (
                      <option key={fo.id} value={fo.id} style={{ fontFamily: fo.id }}>{fo.label}</option>
                    ))}
                  </select>
                  <input type="color" value={text.color} onChange={(e) => setText((t) => ({ ...t, color: e.target.value }))} title="Text colour" />
                  <button type="button" className={`btn btn-sm${text.bold ? ' btn-primary' : ''}`} onClick={() => setText((t) => ({ ...t, bold: !t.bold }))}><b>B</b></button>
                  <button type="button" className={`btn btn-sm${text.italic ? ' btn-primary' : ''}`} onClick={() => setText((t) => ({ ...t, italic: !t.italic }))}><i>I</i></button>
                  {['left', 'center', 'right'].map((al) => (
                    <button key={al} type="button" className={`btn btn-sm${text.align === al ? ' btn-primary' : ''}`} onClick={() => setText((t) => ({ ...t, align: al }))} title={`Align ${al}`}>
                      <i className={`fa-solid fa-align-${al}`} />
                    </button>
                  ))}
                </div>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Size</span><span className="photo-slider-value">{Math.round(text.size * 100)}</span></span>
                  <input type="range" min={2} max={40} value={Math.round(text.size * 100)} onChange={(e) => setText((t) => ({ ...t, size: Number(e.target.value) / 100 }))} />
                </label>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Outline</span><span className="photo-slider-value">{text.strokeWidth}</span></span>
                  <input type="range" min={0} max={100} value={text.strokeWidth} onChange={(e) => setText((t) => ({ ...t, strokeWidth: Number(e.target.value) }))} />
                </label>
                <div className="photo-text-grid">
                  <label className="checkbox-row"><input type="checkbox" checked={text.shadow} onChange={(e) => setText((t) => ({ ...t, shadow: e.target.checked }))} /><span>Shadow</span></label>
                  <label className="checkbox-row"><input type="checkbox" checked={Boolean(text.background)} onChange={(e) => setText((t) => ({ ...t, background: e.target.checked ? 'rgba(0,0,0,0.55)' : '' }))} /><span>Background box</span></label>
                  {text.strokeWidth > 0 && <input type="color" value={text.strokeColor} onChange={(e) => setText((t) => ({ ...t, strokeColor: e.target.value }))} title="Outline colour" />}
                </div>
                <button type="button" className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => { setSticker((s) => ({ ...s, emoji: '' })); placeText(0.5, 0.5); }} disabled={Boolean(busy)}>
                  Add text in the centre
                </button>
                <p className="field-hint">…or click anywhere on the photo to place it there.</p>

                <div className="photo-section-label">Stickers</div>
                <div className="photo-stickers">
                  {STICKERS.map((s) => (
                    <button key={s} type="button" className={sticker.emoji === s ? 'active' : ''} onClick={() => setSticker((st) => ({ ...st, emoji: st.emoji === s ? '' : s }))}>
                      {s}
                    </button>
                  ))}
                </div>
                {sticker.emoji && (
                  <>
                    <label className="photo-slider" style={{ marginTop: 8 }}>
                      <span className="photo-slider-head"><span>Sticker size</span><span className="photo-slider-value">{Math.round(sticker.size * 100)}</span></span>
                      <input type="range" min={4} max={60} value={Math.round(sticker.size * 100)} onChange={(e) => setSticker((s) => ({ ...s, size: Number(e.target.value) / 100 }))} />
                    </label>
                    <p className="field-hint">Click the photo to stick {sticker.emoji} there.</p>
                  </>
                )}
              </>
            )}

            {tab === 'frames' && (
              <>
                <div className="photo-filters">
                  {FRAMES.map((fr) => (
                    <button key={fr.id} type="button" className={`photo-filter${frame.id === fr.id ? ' active' : ''}`} onClick={() => setFrame((x) => ({ ...x, id: fr.id }))}>
                      <span className={`photo-frame-swatch fr-${fr.id}`} />
                      {fr.label}
                    </button>
                  ))}
                </div>
                {FRAMES.find((fr) => fr.id === frame.id)?.color && (
                  <div className="photo-color-row" style={{ marginTop: 10 }}>
                    <input type="color" value={frame.color} onChange={(e) => setFrame((x) => ({ ...x, color: e.target.value }))} />
                    <div className="photo-swatches">
                      {['#ffffff', '#000000', '#f4efe6', '#1f2430', '#35c2a6', '#e8a33d', '#e5646b'].map((c) => (
                        <button key={c} type="button" style={{ background: c }} onClick={() => setFrame((x) => ({ ...x, color: c }))} />
                      ))}
                    </div>
                  </div>
                )}
                <label className="photo-slider" style={{ marginTop: 10 }}>
                  <span className="photo-slider-head"><span>Thickness</span><span className="photo-slider-value">{frame.size}</span></span>
                  <input type="range" min={5} max={100} value={frame.size} onChange={(e) => setFrame((x) => ({ ...x, size: Number(e.target.value) }))} />
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ width: '100%' }}
                  disabled={Boolean(busy)}
                  onClick={() => bake(`Frame: ${FRAMES.find((fr) => fr.id === frame.id).label}`, (src) => applyFrame(src, frame.id, frame), adjust, { overlay: true })}
                >
                  Add frame
                </button>
                <p className="field-hint">Rounded and circle frames leave transparent corners — save as PNG to keep them.</p>
              </>
            )}

            {tab === 'transform' && (
              <>
                <div className="photo-section-label">Crop</div>
                <div className="photo-btn-row wrap">
                  {ASPECTS.map((a) => (
                    <button key={a.id} type="button" className={`btn btn-sm${crop?.aspect === a.id ? ' btn-primary' : ''}`} onClick={() => startCrop(a.id)} disabled={Boolean(busy)}>
                      {a.label}
                    </button>
                  ))}
                </div>
                {crop && (
                  <>
                    <div className="photo-btn-row" style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={applyCrop}>✓ Apply crop</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCrop(null)}>Cancel</button>
                    </div>
                    <p className="field-hint">Drag the box to move it, drag the corners to resize.</p>
                  </>
                )}

                <div className="photo-section-label">Social media &amp; print sizes</div>
                <select
                  className="input input-sm"
                  value=""
                  onChange={(e) => {
                    const p = SIZE_PRESETS[Number(e.target.value)];
                    if (p) startCrop(`preset-${e.target.value}`, p.w / p.h, p);
                  }}
                >
                  <option value="">Choose a size… ({SIZE_PRESETS.length})</option>
                  {SIZE_PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>{p.label} — {p.w}×{p.h}</option>
                  ))}
                </select>
                {crop?.target && <p className="field-hint">Position the box, then Apply — the photo is cropped and resized to exactly {crop.target.w}×{crop.target.h}.</p>}

                <div className="photo-section-label">Rotate &amp; flip</div>
                <div className="photo-btn-row wrap">
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Rotate left', (s) => rotateCanvas(s, -1))}><i className="fa-solid fa-rotate-left" /> Left</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Rotate right', (s) => rotateCanvas(s, 1))}><i className="fa-solid fa-rotate-right" /> Right</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Flip horizontal', (s) => flipCanvas(s, true))}>⇋ Flip H</button>
                  <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => bake('Flip vertical', (s) => flipCanvas(s, false))}>⇵ Flip V</button>
                </div>
                <label className="photo-slider">
                  <span className="photo-slider-head"><span>Straighten</span><span className="photo-slider-value">{straighten}°</span></span>
                  <input type="range" min={-30} max={30} step={0.5} value={straighten} onChange={(e) => setStraighten(Number(e.target.value))} />
                </label>
                {straighten !== 0 && (
                  <div className="photo-btn-row">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => { const d = straighten; setStraighten(0); bake('Straighten', (s) => straightenCanvas(s, d)); }}>
                      ✓ Apply {straighten}°
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStraighten(0)}>Cancel</button>
                  </div>
                )}

                <div className="photo-section-label">Resize</div>
                <div className="photo-resize">
                  <input
                    className="input input-sm"
                    type="number"
                    min={1}
                    value={size.w}
                    onChange={(e) => {
                      const w = e.target.value;
                      setSize((s) => ({ ...s, w, h: s.lock && w ? Math.round((Number(w) * base.height) / base.width) : s.h }));
                    }}
                    aria-label="Width"
                  />
                  <span>×</span>
                  <input
                    className="input input-sm"
                    type="number"
                    min={1}
                    value={size.h}
                    onChange={(e) => {
                      const h = e.target.value;
                      setSize((s) => ({ ...s, h, w: s.lock && h ? Math.round((Number(h) * base.width) / base.height) : s.w }));
                    }}
                    aria-label="Height"
                  />
                  <label className="checkbox-row" title="Keep proportions">
                    <input type="checkbox" checked={size.lock} onChange={(e) => setSize((s) => ({ ...s, lock: e.target.checked }))} />
                    <span>🔗</span>
                  </label>
                  <button type="button" className="btn btn-sm btn-primary" onClick={applyResize} disabled={Boolean(busy)}>Apply</button>
                </div>
                <div className="photo-btn-row wrap" style={{ marginTop: 6 }}>
                  {[
                    ['50%', 0.5],
                    ['HD 1280', 1280],
                    ['Full HD 1920', 1920],
                    ['4K 3840', 3840],
                  ].map(([label, v]) => (
                    <button
                      key={label}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        const long = Math.max(base.width, base.height);
                        const k = v < 1 ? v : v / long;
                        setSize((s) => ({ ...s, w: Math.round(base.width * k), h: Math.round(base.height * k) }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === 'export' && (
              <>
                <div className="field-group">
                  <label className="field-label">Format</label>
                  <div className="photo-btn-row">
                    {[
                      ['image/jpeg', 'JPG'],
                      ['image/png', 'PNG'],
                      ['image/webp', 'WEBP'],
                    ].map(([id, label]) => (
                      <button key={id} type="button" className={`btn btn-sm${format === id ? ' btn-primary' : ''}`} onClick={() => setFormat(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {format !== 'image/png' && (
                  <label className="photo-slider">
                    <span className="photo-slider-head"><span>Quality</span><span className="photo-slider-value">{quality}%</span></span>
                    <input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                  </label>
                )}
                <p className="field-hint">
                  Saves at full size ({base.width} × {base.height}px) with every adjustment applied. PNG keeps transparency and is lossless.
                </p>
                <button type="button" className="btn btn-primary" onClick={download} disabled={Boolean(busy)} style={{ width: '100%' }}>
                  ⬇ Download edited photo
                </button>
                <button type="button" className="btn" onClick={downloadPdf} disabled={Boolean(busy)} style={{ width: '100%', marginTop: 8 }}>
                  <i className="fa-solid fa-file-pdf" /> Download as PDF
                </button>
                <div className="photo-section-label">History</div>
                <ol className="photo-history">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className={i === index ? 'active' : ''}
                        onClick={() => {
                          setIndex(i);
                          setAdjust(h.adjust);
                        }}
                      >
                        {h.label}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </aside>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
      {pexels && <PexelsPicker onPick={([p]) => openPexels(p)} onClose={() => setPexels(false)} />}
    </div>
  );
}
