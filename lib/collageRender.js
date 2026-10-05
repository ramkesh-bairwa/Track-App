// Drawing for the collage maker: backgrounds, grid cells (with shapes,
// borders and shadows), and free layers (photos, text, stickers, shapes).
// The same function renders the live preview and the full-size export.
import { DEFAULT_ADJUST, applyAdjustments, makeCanvas } from './imageOps';
import { FILTER_LIBRARY } from './imageEffects';
import { gridCells } from './collageLayouts';

export const CELL_SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'circle', label: 'Circle / oval' },
  { id: 'arch', label: 'Arch' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'heart', label: 'Heart' },
  { id: 'star', label: 'Star' },
  { id: 'blob', label: 'Soft blob' },
];

export const LAYER_SHAPES = [
  { id: 'rect', label: 'Rectangle', icon: 'fa-regular fa-square' },
  { id: 'circle', label: 'Circle', icon: 'fa-regular fa-circle' },
  { id: 'line', label: 'Line', icon: 'fa-solid fa-minus' },
  { id: 'arrow', label: 'Arrow', icon: 'fa-solid fa-arrow-right-long' },
  { id: 'star', label: 'Star', icon: 'fa-regular fa-star' },
  { id: 'heart', label: 'Heart', icon: 'fa-regular fa-heart' },
];

export const PATTERNS = [
  { id: 'dots', label: 'Dots' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'grid', label: 'Grid' },
  { id: 'checker', label: 'Checker' },
  { id: 'waves', label: 'Waves' },
];

// Quick looks for new text layers.
export const TEXT_STYLES = [
  { id: 'title', label: 'Big title', font: 'Arial Black', size: 0.09, color: '#ffffff', bold: true, stroke: 0, shadow: true },
  { id: 'subtitle', label: 'Subtitle', font: 'IBM Plex Sans', size: 0.045, color: '#ffffff', bold: false, shadow: true, letterSpacing: 0.3 },
  { id: 'label', label: 'Label', font: 'IBM Plex Sans', size: 0.04, color: '#111111', bold: true, bg: '#ffffff', shadow: false },
  { id: 'script', label: 'Handwritten', font: 'Brush Script MT', size: 0.08, color: '#ffffff', shadow: true },
  { id: 'outline', label: 'Outline', font: 'Impact', size: 0.08, color: '#ffffff', stroke: 8, strokeColor: '#111111', shadow: false },
  { id: 'neon', label: 'Neon', font: 'Trebuchet MS', size: 0.07, color: '#ffffff', glow: '#ff2bd6', shadow: false },
  { id: 'serif', label: 'Elegant', font: 'Georgia', size: 0.06, color: '#ffffff', italic: true, shadow: true, letterSpacing: 0.1 },
  { id: 'stamp', label: 'Stamp', font: 'Courier New', size: 0.045, color: '#e5484d', bold: true, stroke: 0, box: '#e5484d', shadow: false },
];

// ---------- geometry ----------
export function shapePath(ctx, shape, x, y, w, h, r = 0) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'arch': {
      const rad = Math.min(w / 2, h);
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + rad);
      ctx.arc(cx, y + rad, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      break;
    }
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = cx + (w / 2) * Math.cos(a);
        const py = cy + (h / 2) * Math.sin(a);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, cy);
      ctx.lineTo(cx, y + h);
      ctx.lineTo(x, cy);
      ctx.closePath();
      break;
    case 'heart':
      ctx.moveTo(cx, y + h * 0.95);
      ctx.bezierCurveTo(x - w * 0.05, y + h * 0.6, x + w * 0.05, y + h * 0.05, cx, y + h * 0.28);
      ctx.bezierCurveTo(x + w * 0.95, y + h * 0.05, x + w * 1.05, y + h * 0.6, cx, y + h * 0.95);
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (Math.PI / 5) * i;
        const k = i % 2 ? 0.45 : 1;
        const px = cx + (w / 2) * k * Math.cos(a);
        const py = cy + (h / 2) * k * Math.sin(a);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    case 'blob': {
      const pts = 8;
      const radii = [1, 0.9, 1, 0.86, 0.97, 0.88, 1, 0.92];
      const P = radii.map((k, i) => {
        const a = (Math.PI * 2 * i) / pts;
        return [cx + (w / 2) * k * Math.cos(a), cy + (h / 2) * k * Math.sin(a)];
      });
      ctx.moveTo((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2);
      for (let i = 1; i <= pts; i++) {
        const p = P[i % pts];
        const n = P[(i + 1) % pts];
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
      }
      ctx.closePath();
      break;
    }
    default: {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }
}

// Pixel rectangles for every grid cell.
export function cellRects(doc, layout, W, H) {
  const unit = Math.min(W, H) / 1000;
  const m = doc.margin * unit;
  const g = doc.spacing * unit;
  const iw = W - m * 2;
  const ih = H - m * 2;
  return gridCells(layout.grid, doc.colW, doc.rowH).map((c) => {
    const left = c.x > 0.0001 ? g / 2 : 0;
    const top = c.y > 0.0001 ? g / 2 : 0;
    const right = c.x + c.w < 0.9999 ? g / 2 : 0;
    const bottom = c.y + c.h < 0.9999 ? g / 2 : 0;
    return { x: m + c.x * iw + left, y: m + c.y * ih + top, w: c.w * iw - left - right, h: c.h * ih - top - bottom };
  });
}

// ---------- processed photos (filter + adjustments + flip/rotate), cached ----------
const PHOTO_ADJUST_KEYS = ['exposure', 'brightness', 'contrast', 'saturation', 'warmth', 'blur', 'sharpness', 'vignette'];

export function processedPhoto(cache, image, opts = {}) {
  if (!image) return null;
  const { filter = 'none', adjust = {}, flipH = false, flipV = false, rotate = 0 } = opts;
  const adjKey = PHOTO_ADJUST_KEYS.map((k) => adjust[k] || 0).join(',');
  const key = `${image.id}|${filter}|${adjKey}|${flipH ? 1 : 0}${flipV ? 1 : 0}|${rotate}`;
  if (cache.has(key)) return cache.get(key);
  const src = image.img;
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const plain = filter === 'none' && adjKey.split(',').every((v) => v === '0') && !flipH && !flipV && !rotate;
  if (plain) {
    cache.set(key, src);
    return src;
  }
  const k = Math.min(1, 2600 / Math.max(sw, sh));
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  const quarter = rotate % 180 !== 0;
  const c = makeCanvas(quarter ? h : w, quarter ? w : h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!plain && (filter !== 'none' || adjKey.split(',').some((v) => v !== '0'))) {
    const p = FILTER_LIBRARY.find((x) => x.id === filter);
    const merged = { ...DEFAULT_ADJUST, ...(p?.adjust || {}) };
    for (const key2 of PHOTO_ADJUST_KEYS) merged[key2] = (merged[key2] || 0) + (adjust[key2] || 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    applyAdjustments(data, merged);
    ctx.putImageData(data, 0, 0);
  }
  cache.set(key, c);
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return c;
}

function drawCover(ctx, img, r, { zoom = 1, panX = 0, panY = 0 } = {}) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(r.w / iw, r.h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const x = r.x + (r.w - dw) / 2 + (panX * (dw - r.w)) / 2;
  const y = r.y + (r.h - dh) / 2 + (panY * (dh - r.h)) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, dw, dh);
}

// ---------- backgrounds ----------
function patternTile(p, fg, bg, size) {
  const s = Math.max(4, Math.round(size));
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1, s / 8);
  switch (p) {
    case 'dots':
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stripes':
      ctx.fillRect(0, 0, s / 2, s);
      break;
    case 'diagonal':
      ctx.beginPath();
      ctx.moveTo(-1, s + 1);
      ctx.lineTo(s + 1, -1);
      ctx.moveTo(-s / 2, s / 2);
      ctx.lineTo(s / 2, -s / 2);
      ctx.moveTo(s / 2, s * 1.5);
      ctx.lineTo(s * 1.5, s / 2);
      ctx.stroke();
      break;
    case 'grid':
      ctx.lineWidth = Math.max(1, s / 16);
      ctx.strokeRect(0, 0, s, s);
      break;
    case 'checker':
      ctx.fillRect(0, 0, s / 2, s / 2);
      ctx.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
    case 'waves':
      ctx.beginPath();
      ctx.moveTo(0, s / 2);
      ctx.quadraticCurveTo(s / 4, s / 4, s / 2, s / 2);
      ctx.quadraticCurveTo((s * 3) / 4, (s * 3) / 4, s, s / 2);
      ctx.stroke();
      break;
    default:
  }
  return c;
}

function drawBackground(ctx, bg, W, H, images, cache) {
  ctx.clearRect(0, 0, W, H);
  if (bg.type === 'transparent') return;
  if (bg.type === 'gradient') {
    const a = ((bg.angle ?? 135) * Math.PI) / 180;
    const grad = bg.radial
      ? ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2)
      : ctx.createLinearGradient(W / 2 - (Math.cos(a) * W) / 2, H / 2 - (Math.sin(a) * H) / 2, W / 2 + (Math.cos(a) * W) / 2, H / 2 + (Math.sin(a) * H) / 2);
    const stops = bg.stops?.length ? bg.stops : [bg.from || '#ff9a8b', bg.to || '#4fa6e8'];
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (bg.type === 'pattern') {
    const tile = patternTile(bg.pattern, bg.fg || '#e9e2d6', bg.color || '#ffffff', ((bg.scale || 40) * Math.min(W, H)) / 1000);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (bg.type === 'photo') {
    const im = images.find((x) => x.id === bg.imageId);
    if (im) {
      // Cheap, even blur: draw small, then scale up smoothly.
      const k = Math.max(0.01, 1 / (1 + (bg.blur ?? 40) / 4));
      const small = makeCanvas(Math.max(8, W * k), Math.max(8, H * k));
      const sctx = small.getContext('2d');
      drawCover(sctx, processedPhoto(cache, im, {}), { x: 0, y: 0, w: small.width, h: small.height });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
      if (bg.dim) {
        ctx.fillStyle = `rgba(0,0,0,${bg.dim / 100})`;
        ctx.fillRect(0, 0, W, H);
      }
      return;
    }
  }
  ctx.fillStyle = bg.color || '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

// ---------- text ----------
function fontString(l, px) {
  return `${l.italic ? 'italic ' : ''}${l.bold ? '700 ' : '400 '}${px}px "${l.font || 'IBM Plex Sans'}", sans-serif`;
}

// Measures a text layer: { w, h } in canvas px (unrotated).
export function measureText(ctx, l, W, H) {
  const px = Math.max(4, l.size * Math.min(W, H));
  ctx.save();
  ctx.font = fontString(l, px);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(l.letterSpacing || 0) * px * 0.2}px`;
  const lines = String(l.text || ' ').split('\n');
  let w = Math.max(...lines.map((line) => ctx.measureText(line || ' ').width));
  let h = lines.length * px * (l.lineHeight || 1.2);
  ctx.restore();
  if (l.curve && lines.length === 1) {
    const r = curveRadius(l, w);
    const sweep = w / r;
    w = Math.max(w * 0.6, 2 * r * Math.sin(Math.min(Math.PI, sweep) / 2));
    h = px * 1.3 + r * (1 - Math.cos(Math.min(Math.PI, sweep) / 2));
  }
  const pad = l.bg || l.box ? px * 0.5 : 0;
  return { w: w + pad * 2, h: h + pad, px, pad };
}

function curveRadius(l, textW) {
  // curve −100…100 → arc from almost flat to a half circle.
  const k = Math.abs(l.curve) / 100;
  return textW / Math.max(0.2, k * Math.PI);
}

function drawTextLayer(ctx, l, W, H) {
  const m = measureText(ctx, l, W, H);
  const { px, pad } = m;
  ctx.font = fontString(l, px);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(l.letterSpacing || 0) * px * 0.2}px`;
  ctx.textBaseline = 'middle';
  if (l.bg) {
    ctx.fillStyle = l.bg;
    shapePath(ctx, 'rect', -m.w / 2, -m.h / 2, m.w, m.h, px * 0.35);
    ctx.fill();
  }
  if (l.box) {
    ctx.strokeStyle = l.box;
    ctx.lineWidth = Math.max(2, px * 0.08);
    shapePath(ctx, 'rect', -m.w / 2, -m.h / 2, m.w, m.h, px * 0.12);
    ctx.stroke();
  }
  const paint = (drawFn) => {
    if (l.glow) {
      ctx.shadowColor = l.glow;
      ctx.shadowBlur = px * 0.5;
      drawFn('fill');
      ctx.shadowBlur = px * 0.25;
    } else if (l.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = px * 0.16;
      ctx.shadowOffsetY = px * 0.05;
    }
    if (l.stroke > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = (l.stroke / 100) * px;
      ctx.strokeStyle = l.strokeColor || '#000';
      drawFn('stroke');
    }
    ctx.fillStyle = l.color || '#fff';
    drawFn('fill');
    ctx.shadowColor = 'transparent';
  };

  const lines = String(l.text || '').split('\n');
  if (l.curve && lines.length === 1) {
    // Characters placed one by one around an arc.
    const text = lines[0];
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const r = curveRadius(l, total);
    const dir = l.curve > 0 ? 1 : -1; // + bends like a smile's top (arch), − like a smile
    const cy = dir > 0 ? r - m.h / 2 + px * 0.65 + pad : -r + m.h / 2 - px * 0.65 - pad;
    let a = -total / r / 2;
    ctx.textAlign = 'center';
    [...text].forEach((ch, i) => {
      const mid = a + widths[i] / r / 2;
      ctx.save();
      ctx.translate(Math.sin(mid) * r, cy - dir * Math.cos(mid) * r);
      ctx.rotate(dir * mid);
      paint((mode) => (mode === 'fill' ? ctx.fillText(ch, 0, 0) : ctx.strokeText(ch, 0, 0)));
      ctx.restore();
      a += widths[i] / r;
    });
    return;
  }
  const lh = px * (l.lineHeight || 1.2);
  const align = l.align || 'center';
  ctx.textAlign = align;
  const x = align === 'left' ? -m.w / 2 + pad : align === 'right' ? m.w / 2 - pad : 0;
  const y0 = -((lines.length - 1) * lh) / 2;
  paint((mode) => lines.forEach((line, i) => (mode === 'fill' ? ctx.fillText(line, x, y0 + i * lh) : ctx.strokeText(line, x, y0 + i * lh))));
}

// ---------- layers ----------
// Bounding box of a layer in canvas px: { cx, cy, w, h, rot }.
export function layerBox(ctx, l, W, H) {
  const cx = l.x * W;
  const cy = l.y * H;
  if (l.type === 'text') {
    const m = measureText(ctx, l, W, H);
    return { cx, cy, w: m.w, h: m.h, rot: l.rotation || 0 };
  }
  if (l.type === 'sticker') {
    const s = l.size * Math.min(W, H);
    return { cx, cy, w: s * 1.15, h: s * 1.15, rot: l.rotation || 0 };
  }
  return { cx, cy, w: l.w * W, h: l.h * H, rot: l.rotation || 0 };
}

export function hitLayer(ctx, layers, W, H, px, py) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.hidden || l.locked) continue;
    const b = layerBox(ctx, l, W, H);
    const a = (-(b.rot || 0) * Math.PI) / 180;
    const dx = px - b.cx;
    const dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const slack = Math.max(6, Math.min(W, H) * 0.01);
    if (Math.abs(lx) <= b.w / 2 + slack && Math.abs(ly) <= b.h / 2 + slack) return l;
  }
  return null;
}

function drawLayer(ctx, l, W, H, images, cache) {
  if (l.hidden) return;
  const b = layerBox(ctx, l, W, H);
  const unit = Math.min(W, H) / 1000;
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
  ctx.translate(b.cx, b.cy);
  ctx.rotate(((b.rot || 0) * Math.PI) / 180);
  if (l.type === 'image') {
    const im = images.find((x) => x.id === l.imageId);
    const src = processedPhoto(cache, im, l);
    const border = (l.border || 0) * unit;
    const r = { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h };
    if (l.shadow) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${(l.shadowOpacity ?? 45) / 100})`;
      ctx.shadowBlur = (l.shadowBlur ?? 30) * unit;
      ctx.shadowOffsetY = (l.shadowBlur ?? 30) * unit * 0.35;
      ctx.fillStyle = border ? l.borderColor || '#fff' : '#000';
      shapePath(ctx, l.shape || 'rect', r.x, r.y, r.w, r.h, (l.radius || 0) * unit);
      ctx.fill();
      ctx.restore();
    }
    if (border) {
      ctx.fillStyle = l.borderColor || '#ffffff';
      shapePath(ctx, l.shape || 'rect', r.x, r.y, r.w, r.h, (l.radius || 0) * unit);
      ctx.fill();
    }
    const inner = { x: r.x + border, y: r.y + border, w: r.w - border * 2, h: r.h - border * 2 - (l.polaroid ? border * 2.5 : 0) };
    ctx.save();
    shapePath(ctx, l.shape || 'rect', inner.x, inner.y, inner.w, inner.h, Math.max(0, (l.radius || 0) * unit - border));
    ctx.clip();
    if (src) drawCover(ctx, src, inner, { zoom: l.zoom || 1, panX: l.panX || 0, panY: l.panY || 0 });
    ctx.restore();
  } else if (l.type === 'text') {
    drawTextLayer(ctx, l, W, H);
  } else if (l.type === 'sticker') {
    const s = l.size * Math.min(W, H);
    ctx.font = `${s}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (l.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = s * 0.12;
    }
    ctx.fillText(l.emoji, 0, s * 0.05);
  } else if (l.type === 'shape') {
    const lw = Math.max(1, (l.strokeWidth ?? 6) * unit);
    ctx.lineWidth = lw;
    ctx.strokeStyle = l.stroke || '#ffffff';
    ctx.fillStyle = l.fill || 'transparent';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (l.shape === 'line' || l.shape === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(-b.w / 2, 0);
      ctx.lineTo(b.w / 2, 0);
      ctx.stroke();
      if (l.shape === 'arrow') {
        const head = Math.max(lw * 3, b.h * 0.9);
        ctx.beginPath();
        ctx.moveTo(b.w / 2, 0);
        ctx.lineTo(b.w / 2 - head, -head * 0.6);
        ctx.lineTo(b.w / 2 - head, head * 0.6);
        ctx.closePath();
        ctx.fillStyle = l.stroke || '#fff';
        ctx.fill();
      }
    } else {
      shapePath(ctx, l.shape === 'rect' ? 'rect' : l.shape, -b.w / 2, -b.h / 2, b.w, b.h, (l.radius || 0) * unit);
      if (l.fill && l.fill !== 'transparent') ctx.fill();
      if ((l.strokeWidth ?? 6) > 0) ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- the whole collage ----------
export function drawCollage(canvas, doc, layout, images, cache, W, H, { selectedCell = -1 } = {}) {
  canvas.width = Math.round(W);
  canvas.height = Math.round(H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, doc.bg, W, H, images, cache);
  const unit = Math.min(W, H) / 1000;

  if (doc.mode === 'grid') {
    const rects = cellRects(doc, layout, W, H);
    rects.forEach((r, i) => {
      const slot = doc.slots[i] || {};
      const im = images.find((x) => x.id === slot.imageId);
      const shape = doc.cellShape || 'rect';
      const radius = doc.radius * unit;
      if (doc.cellShadow) {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${(doc.shadowOpacity ?? 40) / 100})`;
        ctx.shadowBlur = (doc.shadowBlur ?? 30) * unit;
        ctx.shadowOffsetY = (doc.shadowBlur ?? 30) * unit * 0.35;
        ctx.fillStyle = '#000';
        shapePath(ctx, shape, r.x, r.y, r.w, r.h, radius);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      shapePath(ctx, shape, r.x, r.y, r.w, r.h, radius);
      ctx.clip();
      if (im) {
        drawCover(ctx, processedPhoto(cache, im, slot), r, slot);
      } else {
        ctx.fillStyle = 'rgba(128,128,128,0.22)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(128,128,128,0.85)';
        ctx.font = `${Math.max(12, 26 * unit)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Photo ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2);
      }
      ctx.restore();
      if (doc.borderWidth > 0) {
        ctx.save();
        ctx.strokeStyle = doc.borderColor || '#fff';
        ctx.lineWidth = doc.borderWidth * unit;
        shapePath(ctx, shape, r.x + (doc.borderWidth * unit) / 2, r.y + (doc.borderWidth * unit) / 2, r.w - doc.borderWidth * unit, r.h - doc.borderWidth * unit, Math.max(0, radius - (doc.borderWidth * unit) / 2));
        ctx.stroke();
        ctx.restore();
      }
      if (i === selectedCell) {
        ctx.save();
        ctx.strokeStyle = '#35c2a6';
        ctx.lineWidth = Math.max(3, 5 * unit);
        ctx.setLineDash([Math.max(6, 12 * unit), Math.max(4, 8 * unit)]);
        shapePath(ctx, shape, r.x + 2, r.y + 2, r.w - 4, r.h - 4, radius);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  for (const l of doc.layers) drawLayer(ctx, l, W, H, images, cache);
  return ctx;
}
