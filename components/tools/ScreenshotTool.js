'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './screenshot-tool.css';
import AreaPicker from './AreaPicker';

// Take a screenshot (screen, window or tab), or paste / open an image, mark
// it up, then copy it, download it or share it by link.
//
// The picture is kept as a base canvas plus a list of shapes drawn on top,
// so every edit can be undone, and shapes can be moved or deleted until the
// image is cropped (cropping flattens them into the picture).

const TOOLS = [
  { id: 'select', icon: 'fa-arrow-pointer', label: 'Select & move', key: 'v' },
  { id: 'pen', icon: 'fa-pen', label: 'Pen', key: 'p' },
  { id: 'highlighter', icon: 'fa-highlighter', label: 'Highlighter', key: 'h' },
  { id: 'line', icon: 'fa-minus', label: 'Line', key: 'l' },
  { id: 'arrow', icon: 'fa-arrow-right-long', label: 'Arrow', key: 'a' },
  { id: 'rect', icon: 'fa-square', label: 'Rectangle', key: 'r', regular: true },
  { id: 'ellipse', icon: 'fa-circle', label: 'Ellipse', key: 'e', regular: true },
  { id: 'text', icon: 'fa-font', label: 'Text', key: 't' },
  { id: 'step', icon: 'fa-1', label: 'Numbered step', key: 'n' },
  { id: 'blur', icon: 'fa-eye-slash', label: 'Blur / hide', key: 'b' },
  { id: 'crop', icon: 'fa-crop-simple', label: 'Crop', key: 'c' },
];
const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff'];
const SIZES = [{ id: 2, label: 'S' }, { id: 4, label: 'M' }, { id: 7, label: 'L' }, { id: 11, label: 'XL' }];
const DELAYS = [0, 3, 5, 10];
const BOX_TYPES = new Set(['line', 'arrow', 'rect', 'ellipse', 'blur']);

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
const sizeText = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), type, quality)
  );
}

// ---------- drawing ----------

// Line widths follow the picture's size, so "M" looks the same on a small
// window grab and a 5K screen.
const scaleOf = (canvas) => Math.max(1, Math.max(canvas.width, canvas.height) / 1400);
const fontPx = (shape, scale) => Math.round((14 + shape.size * 3) * scale);

function box(s) {
  return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

function drawArrow(ctx, s, lw) {
  const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const head = Math.max(lw * 3.2, 12);
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const bx = s.x2 - Math.cos(angle) * Math.min(head * 0.8, len);
  const by = s.y2 - Math.sin(angle) * Math.min(head * 0.8, len);
  ctx.beginPath();
  ctx.moveTo(s.x1, s.y1);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.x2, s.y2);
  ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 7), s.y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 7), s.y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function pixelate(ctx, s) {
  const { x, y, w, h } = box(s);
  if (w < 2 || h < 2) return;
  const block = Math.max(6, Math.round(Math.min(w, h) / 10));
  const tmp = canvasOf(Math.ceil(w / block), Math.ceil(h / block));
  tmp.getContext('2d').drawImage(ctx.canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
  ctx.restore();
}

function drawShape(ctx, s, scale) {
  const lw = s.size * scale;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'pen' || s.type === 'highlighter') {
    if (s.type === 'highlighter') {
      ctx.globalAlpha = 0.38;
      ctx.lineWidth = lw * 4;
      ctx.lineCap = 'butt';
    }
    ctx.beginPath();
    s.points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
    ctx.stroke();
  } else if (s.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  } else if (s.type === 'arrow') {
    drawArrow(ctx, s, lw);
  } else if (s.type === 'rect') {
    const b = box(s);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  } else if (s.type === 'ellipse') {
    const b = box(s);
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === 'blur') {
    pixelate(ctx, s);
  } else if (s.type === 'text') {
    const fs = fontPx(s, scale);
    ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    // A thin outline in the opposite tone keeps text readable on any background.
    ctx.lineWidth = Math.max(2, fs / 7);
    ctx.strokeStyle = isLight(s.color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
    s.text.split('\n').forEach((line, i) => {
      ctx.strokeText(line, s.x, s.y + i * fs * 1.2);
      ctx.fillText(line, s.x, s.y + i * fs * 1.2);
    });
  } else if (s.type === 'step') {
    const r = fontPx(s, scale) * 0.75;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r / 6);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = isLight(s.color) ? '#111827' : '#ffffff';
    ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.n), s.x, s.y + r * 0.05);
  }
  ctx.restore();
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
}

// The area a shape covers, for clicking on it and drawing its selection box.
function bounds(s, scale, ctx) {
  const lw = s.size * scale;
  if (s.type === 'pen' || s.type === 'highlighter') {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const m = s.type === 'highlighter' ? lw * 2 : lw;
    return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
  }
  if (BOX_TYPES.has(s.type)) {
    const b = box(s);
    return { x: b.x - lw, y: b.y - lw, w: b.w + 2 * lw, h: b.h + 2 * lw };
  }
  if (s.type === 'step') {
    const r = fontPx(s, scale) * 0.75;
    return { x: s.x - r, y: s.y - r, w: 2 * r, h: 2 * r };
  }
  if (s.type === 'text') {
    const fs = fontPx(s, scale);
    ctx.save();
    ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines = s.text.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.restore();
    return { x: s.x - 4, y: s.y - 4, w: w + 8, h: lines.length * fs * 1.2 + 8 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function moved(s, dx, dy) {
  if (s.points) return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy]) };
  if (BOX_TYPES.has(s.type)) return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

function render(ctx, doc, extra = []) {
  const { base, shapes } = doc;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(base, 0, 0);
  const scale = scaleOf(base);
  for (const s of [...shapes, ...extra]) drawShape(ctx, s, scale);
}

// ---------- capture ----------

const MODES = [
  { id: 'area', icon: 'fa-vector-square', label: 'Selected area', hint: 'Drag a box anywhere on the screen' },
  { id: 'screen', icon: 'fa-desktop', label: 'Single screen', hint: 'One whole screen' },
  { id: 'all', icon: 'fa-table-columns', label: 'All screens', hint: 'Every screen in one image' },
  { id: 'window', icon: 'fa-window-maximize', label: 'Window / tab', hint: 'Pick a window or browser tab' },
  { id: 'page', icon: 'fa-scroll', label: 'Full page', hint: 'A whole web page, top to bottom' },
];

const desktopShots = () => (typeof window !== 'undefined' ? window.mytrackDesktop?.screenshot : null);

// Screens from the Mac app ({ png, x, y, width, height, scaleFactor }) drawn
// where they sit relative to each other, at the sharpest screen's pixel density.
async function stitch(images) {
  const scale = Math.max(...images.map((i) => i.scaleFactor || 1));
  const minX = Math.min(...images.map((i) => i.x));
  const minY = Math.min(...images.map((i) => i.y));
  const maxX = Math.max(...images.map((i) => i.x + i.width));
  const maxY = Math.max(...images.map((i) => i.y + i.height));
  const c = canvasOf((maxX - minX) * scale, (maxY - minY) * scale);
  const ctx = c.getContext('2d');
  for (const i of images) {
    const bmp = await createImageBitmap(new Blob([i.png], { type: 'image/png' }));
    ctx.drawImage(bmp, (i.x - minX) * scale, (i.y - minY) * scale, i.width * scale, i.height * scale);
    bmp.close?.();
  }
  return c;
}

// Browser screens captured one by one, side by side.
function sideBySide(canvases) {
  const c = canvasOf(
    canvases.reduce((w, x) => w + x.width, 0),
    Math.max(...canvases.map((x) => x.height))
  );
  const ctx = c.getContext('2d');
  let x = 0;
  for (const part of canvases) {
    ctx.drawImage(part, x, 0);
    x += part.width;
  }
  return c;
}

async function grabScreen(surface) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 5 }, width: { ideal: 7680 }, height: { ideal: 4320 }, ...(surface ? { displaySurface: surface } : {}) },
    audio: false,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'include',
  });
  return stream;
}

async function frameOf(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  // Let a fresh frame arrive (the first one can still show the share picker).
  await wait(250);
  const c = canvasOf(video.videoWidth, video.videoHeight);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  video.srcObject = null;
  return c;
}

async function canvasFromBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const c = canvasOf(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

function modeHint(mode, native, screens) {
  if (mode === 'area') {
    return native
      ? 'MyTrack hides, every screen dims, and you drag a box anywhere — on any screen. Click once to take that whole screen; Esc cancels.'
      : 'Choose “Entire screen” in the prompt; it then fills your display so you can drag a box anywhere on it.';
  }
  if (mode === 'screen') {
    return native
      ? `MyTrack hides itself and captures ${screens > 1 ? 'the chosen screen' : 'the screen'}.`
      : 'Choose “Entire screen” in the prompt.';
  }
  if (mode === 'all') {
    return native
      ? `All ${screens || ''} screens in one picture, arranged the way they are in Display settings.`.replace('  ', ' ')
      : 'Pick each screen in turn; they are joined side by side.';
  }
  if (mode === 'window') return 'Pick a window or browser tab in the prompt.';
  return native
    ? 'The page is opened privately (not signed in to anything) and captured from top to bottom, up to 16,000 pixels tall.'
    : 'Works in the MyTrack Mac app.';
}

// ---------- component ----------

export default function ScreenshotTool() {
  const [doc, setDoc] = useState(null); // { base: canvas, shapes: [] }
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [name, setName] = useState('');
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [selected, setSelected] = useState(-1);
  const [crop, setCrop] = useState(null); // {x1,y1,x2,y2} while choosing
  const [textBox, setTextBox] = useState(null); // { x, y, value, index? }
  const [zoom, setZoom] = useState('fit');
  const [delay, setDelay] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [format, setFormat] = useState('png');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState(null); // { url, version }
  const [shared, setShared] = useState([]);
  const [canCapture, setCanCapture] = useState(true);
  const [mode, setMode] = useState('area');
  const [displays, setDisplays] = useState([]); // Mac app only
  const [displayId, setDisplayId] = useState('cursor');
  const [pageUrl, setPageUrl] = useState('');
  const [areaImage, setAreaImage] = useState(null); // browser area picker
  const [native, setNative] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const drag = useRef(null);
  const draft = useRef(null);
  const version = useRef(0);
  const toastTimer = useRef(null);
  const textRef = useRef(null); // the open text box; blur and a click can both try to finish it
  textRef.current = textBox;

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const loadShared = useCallback(async () => {
    try {
      const res = await fetch('/api/tools/screenshots', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setShared(json.shots || []);
    } catch {}
  }, []);

  useEffect(() => {
    setCanCapture(Boolean(navigator.mediaDevices?.getDisplayMedia));
    const api = desktopShots();
    setNative(Boolean(api));
    api?.displays().then((list) => setDisplays(list || [])).catch(() => {});
    loadShared();
  }, [loadShared]);

  // ---------- document & history ----------

  const commit = useCallback(
    (next) => {
      setPast((p) => [...p.slice(-60), doc]);
      setFuture([]);
      setDoc(next);
      version.current += 1;
    },
    [doc]
  );

  function open(canvas, label) {
    setDoc({ base: canvas, shapes: [] });
    setPast([]);
    setFuture([]);
    setSelected(-1);
    setCrop(null);
    setTextBox(null);
    setLink(null);
    setError('');
    setName(label || `Screenshot ${stamp()}`);
    version.current += 1;
    if (tool === 'crop' || tool === 'select') setTool('arrow');
  }

  function undo() {
    if (!past.length) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelected(-1);
    version.current += 1;
  }

  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(-1);
    version.current += 1;
  }

  // ---------- painting the visible canvas ----------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    if (canvas.width !== doc.base.width || canvas.height !== doc.base.height) {
      canvas.width = doc.base.width;
      canvas.height = doc.base.height;
    }
    const ctx = canvas.getContext('2d');
    const shapes = textBox?.index !== undefined ? doc.shapes.filter((_, i) => i !== textBox.index) : doc.shapes;
    render(ctx, { ...doc, shapes }, draft.current ? [draft.current] : []);
    const scale = scaleOf(doc.base);
    const px = Math.max(1, scale * 1.5);
    if (selected >= 0 && doc.shapes[selected]) {
      const b = bounds(doc.shapes[selected], scale, ctx);
      ctx.save();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = px;
      ctx.strokeStyle = '#3b82f6';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
    if (crop) {
      const b = box(crop);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill('evenodd');
      ctx.setLineDash([8 * px, 5 * px]);
      ctx.lineWidth = px * 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }, [doc, selected, crop, textBox]);

  useEffect(() => {
    paint();
  }, [paint]);

  // ---------- pointer ----------

  function point(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  }

  function hitTest(x, y) {
    const ctx = canvasRef.current.getContext('2d');
    const scale = scaleOf(doc.base);
    for (let i = doc.shapes.length - 1; i >= 0; i--) {
      const b = bounds(doc.shapes[i], scale, ctx);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
    }
    return -1;
  }

  function onPointerDown(e) {
    if (!doc || e.button !== 0) return;
    // Stops the browser's own mouse-down handling, which would move focus off
    // a text box the instant it opens (and select page text while dragging).
    e.preventDefault();
    if (textBox) {
      finishText();
      return;
    }
    const [x, y] = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const style = { color, size };

    if (tool === 'select') {
      const i = hitTest(x, y);
      setSelected(i);
      if (i >= 0) drag.current = { kind: 'move', index: i, from: [x, y], start: doc.shapes[i], dx: 0, dy: 0 };
      return;
    }
    setSelected(-1);
    if (tool === 'crop') {
      drag.current = { kind: 'crop', from: [x, y] };
      setCrop({ x1: x, y1: y, x2: x, y2: y });
      return;
    }
    if (tool === 'text') {
      const i = hitTest(x, y);
      if (i >= 0 && doc.shapes[i].type === 'text') {
        const s = doc.shapes[i];
        setTextBox({ x: s.x, y: s.y, value: s.text, index: i, color: s.color, size: s.size });
      } else {
        setTextBox({ x, y, value: '', color, size });
      }
      return;
    }
    if (tool === 'step') {
      const n = doc.shapes.filter((s) => s.type === 'step').length + 1;
      commit({ ...doc, shapes: [...doc.shapes, { type: 'step', x, y, n, ...style }] });
      return;
    }
    if (tool === 'pen' || tool === 'highlighter') {
      draft.current = { type: tool, points: [[x, y]], ...style };
    } else {
      draft.current = { type: tool, x1: x, y1: y, x2: x, y2: y, ...style };
    }
    drag.current = { kind: 'draw' };
    paint();
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    let [x, y] = point(e);
    if (d.kind === 'move') {
      d.dx = x - d.from[0];
      d.dy = y - d.from[1];
      const shapes = doc.shapes.slice();
      shapes[d.index] = moved(d.start, d.dx, d.dy);
      setDoc({ ...doc, shapes }); // shown live; committed to history on release
    } else if (d.kind === 'crop') {
      setCrop((c) => ({ ...c, x2: clamp(x, 0, doc.base.width), y2: clamp(y, 0, doc.base.height) }));
    } else if (draft.current) {
      const s = draft.current;
      if (s.points) {
        s.points.push([x, y]);
      } else {
        // Shift: straight lines snap to 45°, boxes become squares / circles.
        if (e.shiftKey) {
          const dx = x - s.x1;
          const dy = y - s.y1;
          if (s.type === 'line' || s.type === 'arrow') {
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            x = s.x1 + Math.cos(a) * len;
            y = s.y1 + Math.sin(a) * len;
          } else {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            x = s.x1 + Math.sign(dx || 1) * m;
            y = s.y1 + Math.sign(dy || 1) * m;
          }
        }
        s.x2 = x;
        s.y2 = y;
      }
      paint();
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'move') {
      if (d.dx || d.dy) {
        const before = { ...doc, shapes: doc.shapes.map((s, i) => (i === d.index ? d.start : s)) };
        setPast((p) => [...p.slice(-60), before]);
        setFuture([]);
        version.current += 1;
      }
    } else if (d.kind === 'draw' && draft.current) {
      const s = draft.current;
      draft.current = null;
      const tiny = s.points ? false : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 3;
      if (!tiny) commit({ ...doc, shapes: [...doc.shapes, s] });
      else paint();
    }
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- text ----------

  function finishText() {
    const t = textRef.current;
    if (!t) return;
    textRef.current = null;
    setTextBox(null);
    const value = t.value.replace(/\s+$/, '');
    const shapes = doc.shapes.slice();
    if (t.index !== undefined) {
      if (value) shapes[t.index] = { ...shapes[t.index], text: value };
      else shapes.splice(t.index, 1);
      if (value !== doc.shapes[t.index].text) commit({ ...doc, shapes });
    } else if (value) {
      commit({ ...doc, shapes: [...shapes, { type: 'text', x: t.x, y: t.y, text: value, color: t.color, size: t.size }] });
    }
  }

  // ---------- edits ----------

  function deleteSelected() {
    if (selected < 0) return;
    commit({ ...doc, shapes: doc.shapes.filter((_, i) => i !== selected) });
    setSelected(-1);
  }

  function restyleSelected(patch) {
    if (selected < 0 || !doc.shapes[selected]) return;
    const shapes = doc.shapes.slice();
    shapes[selected] = { ...shapes[selected], ...patch };
    commit({ ...doc, shapes });
  }

  function flatten() {
    const c = canvasOf(doc.base.width, doc.base.height);
    render(c.getContext('2d'), doc);
    return c;
  }

  function applyCrop() {
    const b = box(crop);
    setCrop(null);
    if (b.w < 4 || b.h < 4) return;
    const flat = flatten();
    const c = canvasOf(b.w, b.h);
    c.getContext('2d').drawImage(flat, Math.round(b.x), Math.round(b.y), c.width, c.height, 0, 0, c.width, c.height);
    commit({ base: c, shapes: [] });
    setTool('arrow');
  }

  function rotate() {
    const flat = flatten();
    const c = canvasOf(flat.height, flat.width);
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(flat, 0, 0);
    commit({ base: c, shapes: [] });
  }

  function clearMarks() {
    if (!doc.shapes.length) return;
    commit({ ...doc, shapes: [] });
    setSelected(-1);
  }

  // ---------- capture & open ----------

  async function countdownFrom(n) {
    for (let s = n; s > 0; s--) {
      setCountdown(s);
      await wait(1000);
    }
    setCountdown(0);
  }

  async function browserFrame(surface) {
    const stream = await grabScreen(surface);
    try {
      await countdownFrom(delay);
      return await frameOf(stream);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function capture() {
    setError('');
    if (mode === 'page' && !pageUrl.trim()) {
      setError('Type the address of the page to capture.');
      return;
    }
    setCapturing(true);
    try {
      const api = desktopShots();
      if (api && mode !== 'window') {
        // The Mac app captures natively (MyTrack hides itself meanwhile).
        const r = await api.capture({ mode, displayId, delay, url: pageUrl.trim() });
        if (r?.canceled) return;
        if (r?.error) throw new Error(r.error);
        const c = r.images.length === 1 && r.images[0].x === 0 && r.images[0].y === 0
          ? await canvasFromBlob(new Blob([r.images[0].png], { type: 'image/png' }))
          : await stitch(r.images);
        open(c, mode === 'page' ? `${r.title || pageUrl} ${stamp()}` : undefined);
        say(r.cut ? 'Captured the first 16,000 pixels of a very long page' : 'Screenshot taken');
        return;
      }
      if (mode === 'page') {
        throw new Error('Full-page capture of a website works in the MyTrack Mac app. In a browser, use the browser’s own “Capture full size screenshot” or take Window / tab instead.');
      }
      if (!canCapture) throw new Error('This browser can’t capture the screen — paste or open an image instead.');
      if (mode === 'all') {
        const parts = [];
        do {
          parts.push(await browserFrame('monitor'));
        } while (window.confirm(`${parts.length} screen${parts.length > 1 ? 's' : ''} captured. Add another screen?`));
        open(sideBySide(parts));
        say('Screenshot taken');
        return;
      }
      const c = await browserFrame(mode === 'window' ? 'window' : 'monitor');
      if (mode === 'area') {
        setAreaImage(c);
        return;
      }
      open(c);
      say('Screenshot taken');
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') setError(err?.message || 'Could not take the screenshot.');
    } finally {
      setCountdown(0);
      setCapturing(false);
    }
  }

  const openBlob = useCallback(
    async (blob, label) => {
      try {
        open(await canvasFromBlob(blob), label);
      } catch {
        setError('That file is not an image this browser can open.');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool]
  );

  async function pasteFromClipboard() {
    setError('');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return openBlob(await item.getType(type), `Pasted image ${stamp()}`);
      }
      setError('There is no image on the clipboard. Copy or take a screenshot first (on a Mac: ⌘⇧⌃4).');
    } catch {
      setError('Press ⌘V / Ctrl+V on this page to paste an image.');
    }
  }

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openBlob(f, f.name.replace(/\.[^.]+$/, ''));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) openBlob(f, f.name.replace(/\.[^.]+$/, ''));
  }

  // Paste anywhere on the page.
  useEffect(() => {
    function onPaste(e) {
      if (e.target.closest?.('input, textarea')) return;
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        openBlob(file, `Pasted image ${stamp()}`);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openBlob]);

  // ---------- output ----------

  const outType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const fileName = () => `${(name || 'Screenshot').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Screenshot'}.${format}`;

  async function copyImage() {
    setError('');
    try {
      const flat = flatten();
      // Clipboards take PNG everywhere; Safari wants the promise itself.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(flat, 'image/png') })]);
      say('Screenshot copied — paste it anywhere');
    } catch {
      setError('This browser blocked copying the image. Use Download instead.');
    }
  }

  async function download() {
    const blob = await toBlob(flatten(), outType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say(`Downloaded ${fileName()}`);
  }

  async function copyLink() {
    setError('');
    let url = link?.version === version.current ? link.url : null;
    if (!url) {
      setBusy('link');
      try {
        const flat = flatten();
        const blob = await toBlob(flat, outType);
        const qs = new URLSearchParams({ name: name || 'Screenshot', w: flat.width, h: flat.height });
        const res = await fetch(`/api/tools/screenshots?${qs}`, { method: 'POST', headers: { 'Content-Type': outType }, body: blob });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not upload the screenshot.');
        url = new URL(json.shot.url, window.location.origin).href;
        setLink({ url, version: version.current });
        loadShared();
      } catch (err) {
        setError(err.message);
        setBusy('');
        return;
      }
      setBusy('');
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied');
    } catch {
      say('Link ready — copy it below');
    }
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      say(msg);
    } catch {
      setError('Could not copy. Select the link and copy it yourself.');
    }
  }

  async function stopSharing(token) {
    if (!window.confirm('Delete this shared screenshot? Its link will stop working.')) return;
    const res = await fetch(`/api/tools/screenshots/${token}`, { method: 'DELETE' });
    if (res.ok) {
      setShared((list) => list.filter((s) => s.token !== token));
      if (link?.url.endsWith(token)) setLink(null);
      say('Link deleted');
    }
  }

  // ---------- keyboard ----------

  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!doc) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        copyImage();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        download();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Enter' && crop) {
        applyCrop();
      } else if (e.key === 'Escape') {
        setCrop(null);
        setSelected(-1);
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) chooseTool(t.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function chooseTool(id) {
    if (textBox) finishText();
    setTool(id);
    setCrop(null);
    if (id !== 'select') setSelected(-1);
  }

  // ---------- view ----------

  const sel = selected >= 0 ? doc?.shapes[selected] : null;
  const shownColor = sel && sel.type !== 'blur' ? sel.color : color;
  const shownSize = sel && sel.type !== 'blur' ? sel.size : size;

  function textStyle() {
    const c = canvasRef.current;
    if (!c || !textBox) return {};
    const r = c.getBoundingClientRect();
    const k = r.width / c.width;
    const fs = fontPx(textBox, scaleOf(doc.base)) * k;
    return {
      left: c.offsetLeft + textBox.x * k,
      top: c.offsetTop + textBox.y * k,
      fontSize: fs,
      lineHeight: 1.2,
      color: textBox.color,
    };
  }

  return (
    <div className="shot-tool">
      {/* -------- capture bar -------- */}
      <div className="tool-panel shot-capture">
        <div className="shot-modes" role="radiogroup" aria-label="What to capture">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={`shot-mode${mode === m.id ? ' on' : ''}`}
              onClick={() => setMode(m.id)}
              disabled={capturing}
            >
              <i className={`fa-solid ${m.icon}`} />
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
        <div className="tool-row shot-capture-row">
          {mode === 'screen' && native && displays.length > 1 && (
            <select className="input input-sm shot-display" value={displayId} onChange={(e) => setDisplayId(e.target.value)} disabled={capturing} aria-label="Screen">
              <option value="cursor">Screen with the mouse</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.width}×{d.height}{d.primary ? ' (main)' : ''}
                </option>
              ))}
            </select>
          )}
          {mode === 'page' && (
            <input
              className="input input-sm shot-url"
              type="url"
              placeholder="https://example.com"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && capture()}
              disabled={capturing}
              aria-label="Page address"
            />
          )}
          <button type="button" className="btn btn-primary" onClick={capture} disabled={capturing}>
            <i className="fa-solid fa-camera" />{' '}
            {capturing
              ? countdown
                ? `Taking in ${countdown}…`
                : mode === 'page'
                  ? 'Loading the page…'
                  : native && mode !== 'window'
                    ? 'Capturing…'
                    : 'Choose what to capture…'
              : `Capture ${MODES.find((m) => m.id === mode).label.toLowerCase()}`}
          </button>
          {mode !== 'page' && (
            <label className="shot-inline">
              <span className="tool-muted">Delay</span>
              <select className="input input-sm" value={delay} onChange={(e) => setDelay(Number(e.target.value))} disabled={capturing}>
                {DELAYS.map((d) => (
                  <option key={d} value={d}>{d ? `${d} seconds` : 'None'}</option>
                ))}
              </select>
            </label>
          )}
          <span className="shot-sep" />
          <button type="button" className="btn" onClick={pasteFromClipboard}>
            <i className="fa-solid fa-paste" /> Paste
          </button>
          <label className="btn">
            <i className="fa-solid fa-folder-open" /> Open image
            <input type="file" accept="image/*" onChange={pickFile} hidden />
          </label>
        </div>
        <p className="field-hint" style={{ margin: '8px 0 0' }}>
          {modeHint(mode, native, displays.length)} You can also paste (⌘V / Ctrl+V) or drop an image here.
        </p>
      </div>

      {error && <div className="top-error" role="alert">{error}</div>}

      {!doc ? (
        <div
          className={`tool-drop shot-empty${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <i className="fa-solid fa-crop-simple" />
          <strong>Take a screenshot, paste one, or drop an image here</strong>
          <span className="tool-muted">Then mark it up with arrows, boxes, text, numbered steps, highlighter and blur.</span>
        </div>
      ) : (
        <div className="tool-panel shot-editor">
          {/* -------- toolbar -------- */}
          <div className="shot-toolbar" role="toolbar" aria-label="Editing tools">
            <div className="shot-group">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`shot-tool-btn${tool === t.id ? ' on' : ''}`}
                  onClick={() => chooseTool(t.id)}
                  title={`${t.label} (${t.key.toUpperCase()})`}
                  aria-label={t.label}
                  aria-pressed={tool === t.id}
                >
                  <i className={`${t.regular ? 'fa-regular' : 'fa-solid'} ${t.icon}`} />
                </button>
              ))}
            </div>
            <div className="shot-group">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`shot-swatch${shownColor === c ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    if (sel && sel.type !== 'blur') restyleSelected({ color: c });
                  }}
                  aria-label={`Colour ${c}`}
                  title={c}
                />
              ))}
              <label className="shot-swatch shot-swatch-custom" title="Any colour">
                <input
                  type="color"
                  value={shownColor}
                  onChange={(e) => {
                    setColor(e.target.value);
                    if (sel && sel.type !== 'blur') restyleSelected({ color: e.target.value });
                  }}
                />
              </label>
            </div>
            <div className="shot-group">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`shot-size${shownSize === s.id ? ' on' : ''}`}
                  onClick={() => {
                    setSize(s.id);
                    if (sel && sel.type !== 'blur') restyleSelected({ size: s.id });
                  }}
                  title={`Size ${s.label}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="shot-group">
              <button type="button" className="shot-tool-btn" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo">
                <i className="fa-solid fa-rotate-left" />
              </button>
              <button type="button" className="shot-tool-btn" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">
                <i className="fa-solid fa-rotate-right" />
              </button>
              <button type="button" className="shot-tool-btn" onClick={rotate} title="Rotate 90°" aria-label="Rotate">
                <i className="fa-solid fa-arrows-rotate" />
              </button>
              <button type="button" className="shot-tool-btn" onClick={deleteSelected} disabled={selected < 0} title="Delete selected (Del)" aria-label="Delete selected">
                <i className="fa-solid fa-trash-can" />
              </button>
              <button type="button" className="shot-tool-btn" onClick={clearMarks} disabled={!doc.shapes.length} title="Remove all markings" aria-label="Remove all markings">
                <i className="fa-solid fa-eraser" />
              </button>
              <button type="button" className="shot-tool-btn" onClick={() => setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))} title={zoom === 'fit' ? 'Actual size' : 'Fit to window'} aria-label="Zoom">
                <i className={`fa-solid ${zoom === 'fit' ? 'fa-magnifying-glass-plus' : 'fa-magnifying-glass-minus'}`} />
              </button>
            </div>
          </div>

          {crop && (
            <div className="shot-cropbar">
              <span>Drag to choose the area to keep.</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={applyCrop}>
                <i className="fa-solid fa-check" /> Crop
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCrop(null)}>Cancel</button>
            </div>
          )}

          {/* -------- canvas -------- */}
          <div ref={stageRef} className={`shot-stage${zoom === 'fit' ? ' fit' : ''}`}>
            <canvas
              ref={canvasRef}
              className={`shot-canvas tool-${tool}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {textBox && (
              <textarea
                className="shot-text-input"
                style={textStyle()}
                autoFocus
                rows={Math.max(1, textBox.value.split('\n').length)}
                value={textBox.value}
                placeholder="Type…"
                onChange={(e) => setTextBox((t) => ({ ...t, value: e.target.value }))}
                onBlur={finishText}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finishText();
                  } else if (e.key === 'Escape') {
                    textRef.current = null;
                    setTextBox(null);
                  }
                }}
              />
            )}
          </div>

          {/* -------- output -------- */}
          <div className="shot-output">
            <input className="input input-sm shot-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" />
            <span className="tool-muted shot-dims">{doc.base.width} × {doc.base.height}</span>
            <select className="input input-sm" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Format">
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
            <span className="shot-sep" />
            <button type="button" className="btn" onClick={copyImage}>
              <i className="fa-solid fa-copy" /> Copy screenshot
            </button>
            <button type="button" className="btn" onClick={download}>
              <i className="fa-solid fa-download" /> Download
            </button>
            <button type="button" className="btn btn-primary" onClick={copyLink} disabled={busy === 'link'}>
              <i className="fa-solid fa-link" /> {busy === 'link' ? 'Uploading…' : 'Copy URL'}
            </button>
          </div>
          {link && (
            <div className="shot-link">
              <i className="fa-solid fa-link" />
              <input className="input input-sm" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Screenshot link" />
              <button type="button" className="btn btn-sm" onClick={() => copyText(link.url, 'Link copied')}>Copy</button>
              <a className="btn btn-sm" href={link.url} target="_blank" rel="noreferrer">Open</a>
              {link.version !== version.current && <span className="tool-muted">Edited since — Copy URL again for a new link.</span>}
            </div>
          )}
        </div>
      )}

      {/* -------- shared links -------- */}
      {shared.length > 0 && (
        <div className="tool-panel">
          <h2>Shared screenshots</h2>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Anyone with a link can open that screenshot. Delete one to make its link stop working.
          </p>
          <ul className="shot-shared">
            {shared.map((s) => {
              const url = typeof window === 'undefined' ? s.url : new URL(s.url, window.location.origin).href;
              return (
                <li key={s.token}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="shot-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.name || 'Screenshot'} loading="lazy" />
                  </a>
                  <div className="shot-shared-meta">
                    <strong title={s.name}>{s.name || 'Screenshot'}</strong>
                    <span className="tool-muted">
                      {s.width && s.height ? `${s.width}×${s.height} · ` : ''}{sizeText(s.size)} · {new Date(String(s.created_at).replace(' ', 'T')).toLocaleString()}
                    </span>
                    <div className="tool-row">
                      <button type="button" className="btn btn-sm" onClick={() => copyText(url, 'Link copied')}>
                        <i className="fa-solid fa-link" /> Copy URL
                      </button>
                      <a className="btn btn-sm" href={`${s.url}?download`}>
                        <i className="fa-solid fa-download" />
                      </a>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => stopSharing(s.token)} aria-label="Delete link">
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {areaImage && (
        <AreaPicker
          image={areaImage}
          onDone={(c) => {
            setAreaImage(null);
            open(c);
            say('Screenshot taken');
          }}
          onCancel={() => setAreaImage(null)}
        />
      )}

      {toast && <div className="shot-toast" role="status">{toast}</div>}
    </div>
  );
}
