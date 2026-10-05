// Creative effects, the big filter library, frames, stickers, fonts and size
// presets for the photo editor. Like lib/imageOps.js, everything runs in the
// browser on ImageData / canvases.
import { FILTER_PRESETS, gaussianBlur, makeCanvas } from './imageOps';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lumOf = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const copyOf = (img) => ({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height });

function rng(seed = 7) {
  let s = seed % 2147483647 || 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function mixInto(img, out, k) {
  const d = img.data;
  const o = out.data || out;
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (o[i] - d[i]) * k;
    d[i + 1] += (o[i + 1] - d[i + 1]) * k;
    d[i + 2] += (o[i + 2] - d[i + 2]) * k;
  }
  return img;
}

function blurred(img, radius) {
  const c = copyOf(img);
  gaussianBlur(c, radius);
  return c;
}

// Kuwahara filter via summed-area tables (O(n) whatever the radius): each
// pixel takes the mean colour of its calmest neighbouring quadrant, which
// flattens texture into painted-looking strokes while keeping edges.
function kuwahara(img, radius) {
  const { data: d, width: w, height: h } = img;
  const W = w + 1;
  const n = W * (h + 1);
  const sr = new Float64Array(n);
  const sg = new Float64Array(n);
  const sb = new Float64Array(n);
  const sl = new Float64Array(n);
  const sl2 = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    let ar = 0, ag = 0, ab = 0, al = 0, al2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = lumOf(d, i);
      ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; al += l; al2 += l * l;
      const k = (y + 1) * W + x + 1;
      const up = y * W + x + 1;
      sr[k] = sr[up] + ar; sg[k] = sg[up] + ag; sb[k] = sb[up] + ab; sl[k] = sl[up] + al; sl2[k] = sl2[up] + al2;
    }
  }
  const box = (s, x0, y0, x1, y1) => s[(y1 + 1) * W + x1 + 1] - s[y0 * W + x1 + 1] - s[(y1 + 1) * W + x0] + s[y0 * W + x0];
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity, br = 0, bg = 0, bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q & 1 ? x : x - radius);
        const x1 = Math.min(w - 1, q & 1 ? x + radius : x);
        const y0 = Math.max(0, q & 2 ? y : y - radius);
        const y1 = Math.min(h - 1, q & 2 ? y + radius : y);
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = box(sl, x0, y0, x1, y1) / cnt;
        const v = box(sl2, x0, y0, x1, y1) / cnt - m * m;
        if (v < best) {
          best = v;
          br = box(sr, x0, y0, x1, y1) / cnt;
          bg = box(sg, x0, y0, x1, y1) / cnt;
          bb = box(sb, x0, y0, x1, y1) / cnt;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = br; out[i + 1] = bg; out[i + 2] = bb; out[i + 3] = d[i + 3];
    }
  }
  d.set(out);
  return img;
}

function sobel(img) {
  const { data: d, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = lumOf(d, p * 4);
  const E = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = -L[p - w - 1] - 2 * L[p - 1] - L[p + w - 1] + L[p - w + 1] + 2 * L[p + 1] + L[p + w + 1];
      const gy = -L[p - w - 1] - 2 * L[p - w] - L[p - w + 1] + L[p + w - 1] + 2 * L[p + w] + L[p + w + 1];
      E[p] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return E;
}

function posterizeData(d, levels) {
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
  }
}

function pixelateData(img, size, grout = 0) {
  const { data: d, width: w, height: h } = img;
  for (let by = 0; by < h; by += size) {
    for (let bx = 0; bx < w; bx += size) {
      let r = 0, g = 0, b = 0, c = 0;
      const ey = Math.min(h, by + size);
      const ex = Math.min(w, bx + size);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; c++; }
      r /= c; g /= c; b /= c;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          const edge = grout && (x - bx < grout || y - by < grout);
          d[i] = edge ? r * 0.55 : r; d[i + 1] = edge ? g * 0.55 : g; d[i + 2] = edge ? b * 0.55 : b;
        }
      }
    }
  }
}

function sampleCopy(src, w, h, x, y, c) {
  const xi = x < 0 ? 0 : x >= w ? w - 1 : x | 0;
  const yi = y < 0 ? 0 : y >= h ? h - 1 : y | 0;
  return src[(yi * w + xi) * 4 + c];
}

const HEAT = [[0, 0, 0], [30, 0, 110], [140, 0, 160], [230, 30, 60], [255, 140, 0], [255, 230, 40], [255, 255, 255]];
function heatColor(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (HEAT.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return [0, 1, 2].map((c) => HEAT[i][c] + (HEAT[i + 1][c] - HEAT[i][c]) * f);
}

// Each effect: apply(img, amount 0..100) mutates the ImageData.
// `heavy` effects are run on a ≤6 MP copy of very large photos (see
// applyEffectToCanvas) so they finish in seconds, not minutes.
export const EFFECTS = [
  { id: 'pixelate', label: 'Pixelate', group: 'Stylize', def: 40, apply(img, a) { pixelateData(img, Math.max(2, Math.round(2 + (a / 100) * Math.max(img.width, img.height) / 22))); } },
  { id: 'mosaic', label: 'Mosaic tiles', group: 'Stylize', def: 40, apply(img, a) { const s = Math.max(6, Math.round(6 + (a / 100) * Math.max(img.width, img.height) / 25)); pixelateData(img, s, Math.max(1, Math.round(s / 10))); } },
  { id: 'posterize', label: 'Posterize', group: 'Stylize', def: 60, apply(img, a) { posterizeData(img.data, Math.max(2, Math.round(16 - (a / 100) * 14))); } },
  { id: 'popart', label: 'Pop art', group: 'Stylize', def: 70, apply(img, a) { const d = img.data; posterizeData(d, 4); for (let i = 0; i < d.length; i += 4) { const m = (d[i] + d[i + 1] + d[i + 2]) / 3; const k = 1 + (a / 100) * 1.5; d[i] = clamp(m + (d[i] - m) * k); d[i + 1] = clamp(m + (d[i + 1] - m) * k); d[i + 2] = clamp(m + (d[i + 2] - m) * k); } } },
  { id: 'halftone', label: 'Halftone dots', group: 'Stylize', def: 40, apply(img, a) {
    const { data: d, width: w, height: h } = img; const s = Math.max(4, Math.round(4 + (a / 100) * Math.max(w, h) / 45)); const src = new Uint8ClampedArray(d);
    for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
      let r = 0, g = 0, b = 0, c = 0; const ey = Math.min(h, by + s), ex = Math.min(w, bx + s);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; c++; }
      r /= c; g /= c; b /= c; const dark = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; const rad = (s / 2) * Math.sqrt(dark) * 1.15; const cx = bx + s / 2, cy = by + s / 2;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * w + x) * 4; const inDot = (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad; d[i] = inDot ? r * 0.8 : 250; d[i + 1] = inDot ? g * 0.8 : 248; d[i + 2] = inDot ? b * 0.8 : 242; }
    } } },
  { id: 'oil', label: 'Oil painting', group: 'Artistic', def: 50, heavy: true, apply(img, a) { kuwahara(img, Math.max(2, Math.round(2 + (a / 100) * Math.max(img.width, img.height) / 180))); } },
  { id: 'watercolor', label: 'Watercolor', group: 'Artistic', def: 50, heavy: true, apply(img, a) { kuwahara(img, Math.max(2, Math.round(2 + (a / 100) * Math.max(img.width, img.height) / 220))); gaussianBlur(img, 1.5, 0.6); const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = clamp(d[i] * 0.9 + 24); d[i + 1] = clamp(d[i + 1] * 0.9 + 24); d[i + 2] = clamp(d[i + 2] * 0.9 + 26); } } },
  { id: 'cartoon', label: 'Cartoon', group: 'Artistic', def: 60, heavy: true, apply(img, a) { const E = sobel(img); kuwahara(img, Math.max(2, Math.round(Math.max(img.width, img.height) / 260))); posterizeData(img.data, Math.max(3, Math.round(9 - (a / 100) * 5))); const d = img.data; const t = 110 - a * 0.6; for (let p = 0; p < E.length; p++) if (E[p] > t) { d[p * 4] *= 0.15; d[p * 4 + 1] *= 0.15; d[p * 4 + 2] *= 0.15; } } },
  { id: 'sketch', label: 'Pencil sketch', group: 'Artistic', def: 55, apply(img, a) {
    const d = img.data; const g = new Uint8ClampedArray(d.length); for (let i = 0; i < d.length; i += 4) { const l = lumOf(d, i); g[i] = g[i + 1] = g[i + 2] = 255 - l; g[i + 3] = 255; }
    const inv = { data: g, width: img.width, height: img.height }; gaussianBlur(inv, 2 + (a / 100) * Math.max(img.width, img.height) / 120);
    for (let i = 0; i < d.length; i += 4) { const l = lumOf(d, i); const v = Math.min(255, (l * 255) / Math.max(1, 255 - g[i])); d[i] = d[i + 1] = d[i + 2] = v; } } },
  { id: 'colorsketch', label: 'Colour sketch', group: 'Artistic', def: 55, apply(img, a) { const orig = new Uint8ClampedArray(img.data); EFFECTS.find((e) => e.id === 'sketch').apply(img, a); const d = img.data; for (let i = 0; i < d.length; i += 4) { const k = d[i] / 255; d[i] = orig[i] * k + 255 * (1 - k) * 0.1 * k; d[i + 1] = orig[i + 1] * k; d[i + 2] = orig[i + 2] * k; } } },
  { id: 'emboss', label: 'Emboss', group: 'Artistic', def: 60, apply(img, a) { const { data: d, width: w, height: h } = img; const s = new Uint8ClampedArray(d); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) { const v = 128 + (s[i + c + (w + 1) * 4] - s[i + c - (w + 1) * 4]) * 2; d[i + c] = s[i + c] + (clamp(v) - s[i + c]) * (a / 100); } } } },
  { id: 'edges', label: 'Edge glow', group: 'Artistic', def: 70, apply(img, a) { const E = sobel(img); const d = img.data; const k = a / 100; for (let p = 0; p < E.length; p++) { const i = p * 4; d[i] += (E[p] * (d[i] / 255 + 0.4) - d[i]) * k; d[i + 1] += (E[p] * (d[i + 1] / 255 + 0.4) - d[i + 1]) * k; d[i + 2] += (E[p] * (d[i + 2] / 255 + 0.4) - d[i + 2]) * k; } } },
  { id: 'solarize', label: 'Solarize', group: 'Colour', def: 50, apply(img, a) { const d = img.data; const t = 255 - (a / 100) * 200; for (let i = 0; i < d.length; i++) if ((i & 3) !== 3 && d[i] > t) d[i] = 255 - d[i]; } },
  { id: 'invert', label: 'Invert', group: 'Colour', def: 100, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] += (255 - 2 * d[i]) * k; } },
  { id: 'threshold', label: 'Black & white cut', group: 'Colour', def: 50, apply(img, a) { const d = img.data; const t = 40 + (a / 100) * 175; for (let i = 0; i < d.length; i += 4) { const v = lumOf(d, i) >= t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } } },
  { id: 'crossprocess', label: 'Cross process', group: 'Colour', def: 70, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i += 4) { const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; const nr = r < 0.5 ? 2 * r * r : 1 - 2 * (1 - r) ** 2; const ng = g * 1.08; const nb = b * 0.7 + 0.15; d[i] += (clamp(nr * 255) - d[i]) * k; d[i + 1] += (clamp(ng * 255) - d[i + 1]) * k; d[i + 2] += (clamp(nb * 255) - d[i + 2]) * k; } } },
  { id: 'infrared', label: 'Infrared', group: 'Colour', def: 80, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; const nr = clamp(Math.max(r, g * 1.25)); const ng = clamp(r * 0.55 + b * 0.2); const nb = clamp(b * 0.9 + g * 0.2); d[i] += (nr - r) * k; d[i + 1] += (ng - g) * k; d[i + 2] += (nb - b) * k; } } },
  { id: 'thermal', label: 'Thermal camera', group: 'Colour', def: 100, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i += 4) { const [r, g, b] = heatColor(lumOf(d, i) / 255); d[i] += (r - d[i]) * k; d[i + 1] += (g - d[i + 1]) * k; d[i + 2] += (b - d[i + 2]) * k; } } },
  { id: 'nightvision', label: 'Night vision', group: 'Colour', def: 90, apply(img, a) { const d = img.data; const k = a / 100; const rnd = rng(11); const { width: w, height: h } = img; for (let p = 0, i = 0; i < d.length; i += 4, p++) { const x = p % w, y = (p / w) | 0; const v = Math.min(1, ((x - w / 2) ** 2 + (y - h / 2) ** 2) / ((w * w + h * h) / 4)); const l = Math.min(255, lumOf(d, i) * 1.6 + (rnd() - 0.5) * 40) * (1 - v * 0.8); d[i] += (l * 0.25 - d[i]) * k; d[i + 1] += (l - d[i + 1]) * k; d[i + 2] += (l * 0.3 - d[i + 2]) * k; } } },
  { id: 'xray', label: 'X-ray', group: 'Colour', def: 100, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i += 4) { const v = 255 - lumOf(d, i); d[i] += (v * 0.8 - d[i]) * k; d[i + 1] += (v * 0.92 - d[i + 1]) * k; d[i + 2] += (Math.min(255, v * 1.1) - d[i + 2]) * k; } } },
  { id: 'channelswap', label: 'Channel swap', group: 'Colour', def: 100, apply(img, a) { const d = img.data; const k = a / 100; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] += (b - r) * k; d[i + 1] += (r - g) * k; d[i + 2] += (g - b) * k; } } },
  { id: 'glitch', label: 'Glitch', group: 'Distort', def: 50, apply(img, a) {
    const { data: d, width: w, height: h } = img; const s = new Uint8ClampedArray(d); const shift = Math.round((a / 100) * w * 0.02) + 1; const rnd = rng(3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = sampleCopy(s, w, h, x + shift, y, 0); d[i + 2] = sampleCopy(s, w, h, x - shift, y, 2); }
    const bands = Math.round(3 + a / 8); for (let k = 0; k < bands; k++) { const y0 = Math.floor(rnd() * h); const bh = Math.max(2, Math.floor(rnd() * h * 0.05)); const off = Math.round((rnd() - 0.5) * w * 0.12 * (a / 100)); const snap = new Uint8ClampedArray(d); for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) d[i + c] = sampleCopy(snap, w, h, x - off, y, c); } } } },
  { id: 'chromatic', label: 'Chromatic aberration', group: 'Distort', def: 40, apply(img, a) { const { data: d, width: w, height: h } = img; const s = new Uint8ClampedArray(d); const k = (a / 100) * 0.012; const cx = w / 2, cy = h / 2; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const dx = x - cx, dy = y - cy; d[i] = sampleCopy(s, w, h, cx + dx * (1 + k), cy + dy * (1 + k), 0); d[i + 2] = sampleCopy(s, w, h, cx + dx * (1 - k), cy + dy * (1 - k), 2); } } },
  { id: 'frosted', label: 'Frosted glass', group: 'Distort', def: 40, apply(img, a) { const { data: d, width: w, height: h } = img; const s = new Uint8ClampedArray(d); const r = 1 + (a / 100) * Math.max(w, h) / 160; const rnd = rng(5); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const sx = x + (rnd() - 0.5) * 2 * r, sy = y + (rnd() - 0.5) * 2 * r; for (let c = 0; c < 3; c++) d[i + c] = sampleCopy(s, w, h, sx, sy, c); } } },
  { id: 'mirrorh', label: 'Mirror left ↔ right', group: 'Distort', def: 100, apply(img) { const { data: d, width: w, height: h } = img; for (let y = 0; y < h; y++) for (let x = Math.ceil(w / 2); x < w; x++) { const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4; d[i] = d[j]; d[i + 1] = d[j + 1]; d[i + 2] = d[j + 2]; d[i + 3] = d[j + 3]; } } },
  { id: 'mirrorv', label: 'Mirror top ↕ bottom', group: 'Distort', def: 100, apply(img) { const { data: d, width: w, height: h } = img; for (let y = Math.ceil(h / 2); y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, j = ((h - 1 - y) * w + x) * 4; d[i] = d[j]; d[i + 1] = d[j + 1]; d[i + 2] = d[j + 2]; d[i + 3] = d[j + 3]; } } },
  { id: 'kaleidoscope', label: 'Kaleidoscope', group: 'Distort', def: 100, apply(img) { EFFECTS.find((e) => e.id === 'mirrorh').apply(img); EFFECTS.find((e) => e.id === 'mirrorv').apply(img); } },
  { id: 'motionblur', label: 'Motion blur', group: 'Blur & light', def: 40, apply(img, a) { const { data: d, width: w, height: h } = img; const r = Math.max(1, Math.round((a / 100) * w * 0.03)); const s = new Uint8ClampedArray(d); const div = 2 * r + 1; for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let acc = 0; for (let x = -r; x <= r; x++) acc += sampleCopy(s, w, h, x, y, c); for (let x = 0; x < w; x++) { d[(y * w + x) * 4 + c] = acc / div; acc += sampleCopy(s, w, h, x + r + 1, y, c) - sampleCopy(s, w, h, x - r, y, c); } } } },
  { id: 'zoomblur', label: 'Zoom blur', group: 'Blur & light', def: 40, apply(img, a) { const { data: d, width: w, height: h } = img; const s = new Uint8ClampedArray(d); const k = (a / 100) * 0.08; const cx = w / 2, cy = h / 2; const N = 8; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; let r = 0, g = 0, b = 0; for (let t = 0; t < N; t++) { const f = 1 - (k * t) / N; const sx = cx + (x - cx) * f, sy = cy + (y - cy) * f; r += sampleCopy(s, w, h, sx, sy, 0); g += sampleCopy(s, w, h, sx, sy, 1); b += sampleCopy(s, w, h, sx, sy, 2); } d[i] = r / N; d[i + 1] = g / N; d[i + 2] = b / N; } } },
  { id: 'tiltshift', label: 'Tilt-shift (miniature)', group: 'Blur & light', def: 60, apply(img, a) { const { data: d, width: w, height: h } = img; const b = blurred(img, 2 + (a / 100) * Math.max(w, h) / 90); for (let y = 0; y < h; y++) { const t = Math.min(1, Math.max(0, (Math.abs(y - h / 2) / h - 0.12) / 0.25)); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) { const v = d[i + c] + (b.data[i + c] - d[i + c]) * t; const m = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i + c] = clamp(m + (v - m) * 1.2); } } } } },
  { id: 'glow', label: 'Glow / bloom', group: 'Blur & light', def: 50, apply(img, a) { const { data: d, width: w, height: h } = img; const bright = copyOf(img); const bd = bright.data; for (let i = 0; i < bd.length; i += 4) { if (lumOf(bd, i) < 150) { bd[i] = bd[i + 1] = bd[i + 2] = 0; } } gaussianBlur(bright, 4 + Math.max(w, h) / 60); const k = a / 100; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = 255 - ((255 - d[i + c]) * (255 - bd[i + c] * k)) / 255; } },
  { id: 'dreamy', label: 'Dreamy (Orton)', group: 'Blur & light', def: 50, apply(img, a) { const b = blurred(img, 3 + Math.max(img.width, img.height) / 90); const d = img.data; const k = (a / 100) * 0.7; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const scr = 255 - ((255 - d[i + c]) * (255 - b.data[i + c])) / 255; d[i + c] += (scr - d[i + c]) * k; } } },
  { id: 'lightleak', label: 'Light leak', group: 'Blur & light', def: 60, apply(img, a) { const { data: d, width: w, height: h } = img; const k = a / 100; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const t = Math.max(0, 1 - Math.hypot(x / w, y / h * 0.8) / 0.9); const t2 = Math.max(0, 1 - Math.hypot(1 - x / w, 1 - y / h) / 0.6); const lr = 255 * (t * 0.9 + t2 * 0.6), lg = 120 * t + 60 * t2, lb = 40 * t + 140 * t2; d[i] = 255 - ((255 - d[i]) * (255 - lr * k)) / 255; d[i + 1] = 255 - ((255 - d[i + 1]) * (255 - lg * k)) / 255; d[i + 2] = 255 - ((255 - d[i + 2]) * (255 - lb * k)) / 255; } } },
  { id: 'scanlines', label: 'Scanlines', group: 'Retro', def: 50, apply(img, a) { const { data: d, width: w, height: h } = img; const gap = Math.max(2, Math.round(h / 300)); const k = (a / 100) * 0.6; for (let y = 0; y < h; y++) if (Math.floor(y / gap) % 2) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] *= 1 - k; d[i + 1] *= 1 - k; d[i + 2] *= 1 - k; } } },
  { id: 'noise', label: 'Film noise', group: 'Retro', def: 35, apply(img, a) { const d = img.data; const rnd = rng(9); const k = (a / 100) * 70; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * k; d[i] = clamp(d[i] + n + (rnd() - 0.5) * k * 0.3); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n + (rnd() - 0.5) * k * 0.3); } } },
  { id: 'vhs', label: 'VHS tape', group: 'Retro', def: 60, apply(img, a) { EFFECTS.find((e) => e.id === 'chromatic').apply(img, a * 0.6); gaussianBlur(img, 1, 0.5); const d = img.data; for (let i = 0; i < d.length; i += 4) { const m = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i] = clamp(m + (d[i] - m) * 0.8 + 6); d[i + 1] = clamp(m + (d[i + 1] - m) * 0.8); d[i + 2] = clamp(m + (d[i + 2] - m) * 0.8 + 10); } EFFECTS.find((e) => e.id === 'scanlines').apply(img, a * 0.5); EFFECTS.find((e) => e.id === 'noise').apply(img, a * 0.4); } },
];

const HEAVY_MAX_PIXELS = 6_000_000;

// Runs an effect on a whole canvas (returns a new canvas). Heavy effects on
// very large photos are computed on a smaller copy and scaled back up.
export function applyEffectToCanvas(src, effect, amount) {
  let work = src;
  const px = src.width * src.height;
  const scaled = effect.heavy && px > HEAVY_MAX_PIXELS;
  if (scaled) {
    const k = Math.sqrt(HEAVY_MAX_PIXELS / px);
    work = makeCanvas(src.width * k, src.height * k);
    const wctx = work.getContext('2d');
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(src, 0, 0, work.width, work.height);
  } else {
    const c = makeCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    work = c;
  }
  const ctx = work.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, work.width, work.height);
  effect.apply(img, amount);
  ctx.putImageData(img, 0, 0);
  if (!scaled) return work;
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(work, 0, 0, out.width, out.height);
  return out;
}

// ---------------- Filter library (130+ looks) ----------------
// Every filter is just a set of slider values, so it stays fully editable.
const f = (id, label, group, adjust) => ({ id, label, group, adjust });

const FILM = [
  f('portra', 'Portra 400', 'Film', { warmth: 12, fade: 12, contrast: -6, saturation: -8, shadows: 15, hsl_orange_s: 10, grain: 12 }),
  f('ektar', 'Ektar 100', 'Film', { saturation: 25, contrast: 12, vibrance: 15, hsl_red_s: 15, hsl_blue_s: 20 }),
  f('velvia', 'Velvia 50', 'Film', { saturation: 40, contrast: 20, vibrance: 20, hsl_green_s: 25, blacks: -15 }),
  f('provia', 'Provia 100', 'Film', { contrast: 10, saturation: 10, warmth: -4, clarity: 10 }),
  f('superia', 'Superia 400', 'Film', { tint: -8, saturation: 8, fade: 10, grain: 18, hsl_green_h: -10 }),
  f('gold', 'Gold 200', 'Film', { warmth: 25, saturation: 10, fade: 10, grain: 14, splitHighHue: 45, splitHighSat: 30 }),
  f('trix', 'Tri-X 400', 'Film', { mono: 'grayscale', contrast: 35, grain: 30, blacks: -20 }),
  f('hp5', 'HP5 Plus', 'Film', { mono: 'grayscale', contrast: 18, grain: 25, fade: 8 }),
  f('cinestill', 'CineStill 800T', 'Film', { warmth: -22, tint: 8, contrast: 10, grain: 18, splitHighHue: 20, splitHighSat: 25, splitShadowHue: 200, splitShadowSat: 30 }),
  f('polaroid', 'Polaroid', 'Film', { fade: 30, warmth: 12, contrast: -10, saturation: -12, vignette: 20, tint: 5 }),
  f('instax', 'Instax', 'Film', { exposure: 10, fade: 18, saturation: -5, warmth: -6, contrast: -5 }),
  f('kodachrome', 'Kodachrome', 'Film', { contrast: 22, saturation: 20, warmth: 10, hsl_red_s: 20, hsl_blue_l: -15 }),
  f('agfa', 'Agfa Vista', 'Film', { saturation: 18, warmth: 8, hsl_red_h: 6, fade: 8, grain: 12 }),
  f('lomo', 'Lomo', 'Film', { contrast: 30, saturation: 25, vignette: 55, warmth: 5 }),
  f('expired', 'Expired film', 'Film', { fade: 35, tint: 14, warmth: 18, contrast: -15, grain: 30, saturation: -20 }),
  f('seventies', "’70s", 'Film', { warmth: 30, fade: 25, saturation: -10, hsl_orange_s: 20, grain: 20 }),
  f('eighties', "’80s", 'Film', { saturation: 25, tint: 10, contrast: 12, splitShadowHue: 260, splitShadowSat: 25 }),
  f('disposable', "’90s disposable", 'Film', { exposure: 8, contrast: 15, saturation: 12, grain: 25, vignette: 25, warmth: 8 }),
  f('sx70', 'SX-70', 'Film', { fade: 28, warmth: 20, saturation: -25, contrast: -8, overlayColor: '#e8b27a', overlayAmount: 25 }),
  f('slide', 'Slide film', 'Film', { contrast: 25, blacks: -20, saturation: 15, vignette: 15 }),
];

const CINEMATIC = [
  f('tealorange', 'Teal & orange', 'Cinematic', { splitHighHue: 30, splitHighSat: 45, splitShadowHue: 190, splitShadowSat: 50, contrast: 12, hsl_orange_s: 15, hsl_blue_h: -20 }),
  f('blockbuster', 'Blockbuster', 'Cinematic', { contrast: 25, splitShadowHue: 195, splitShadowSat: 40, splitHighHue: 35, splitHighSat: 30, vignette: 25 }),
  f('matrix', 'Matrix green', 'Cinematic', { tint: -30, saturation: -20, contrast: 20, overlayColor: '#3dbb5a', overlayAmount: 25 }),
  f('bladerunner', 'Neon noir', 'Cinematic', { splitHighHue: 320, splitHighSat: 40, splitShadowHue: 190, splitShadowSat: 55, contrast: 18, exposure: -8 }),
  f('pastel', 'Pastel symmetry', 'Cinematic', { fade: 25, saturation: -10, warmth: 10, tint: 8, hsl_red_l: 15, contrast: -10 }),
  f('bleach', 'Bleach bypass', 'Cinematic', { saturation: -45, contrast: 35, clarity: 25 }),
  f('desert', 'Desert heat', 'Cinematic', { warmth: 40, saturation: -10, contrast: 12, overlayColor: '#d9a45c', overlayAmount: 20 }),
  f('arctic', 'Arctic', 'Cinematic', { warmth: -40, exposure: 8, saturation: -15, contrast: 8 }),
  f('amber', 'Amber night', 'Cinematic', { exposure: -12, warmth: 30, contrast: 18, vignette: 40 }),
  f('moonlight', 'Moonlight', 'Cinematic', { exposure: -18, warmth: -35, saturation: -30, contrast: 15, vignette: 35 }),
  f('golden', 'Golden hour', 'Cinematic', { warmth: 35, exposure: 6, highlights: -15, vibrance: 20, splitHighHue: 40, splitHighSat: 35 }),
  f('scifi', 'Sci-fi', 'Cinematic', { splitShadowHue: 180, splitShadowSat: 60, saturation: -10, contrast: 25, clarity: 20 }),
];

const MOOD = [
  f('moody', 'Moody', 'Mood', { exposure: -10, contrast: 18, saturation: -25, shadows: -10, fade: 12, vignette: 30 }),
  f('airy', 'Light & airy', 'Mood', { exposure: 15, shadows: 30, contrast: -15, saturation: -8, warmth: 5 }),
  f('clean', 'Bright & clean', 'Mood', { exposure: 10, whites: 20, clarity: 10, vibrance: 15 }),
  f('forest', 'Dark forest', 'Mood', { hsl_green_l: -30, hsl_green_s: -20, exposure: -8, contrast: 15, fade: 10 }),
  f('rustic', 'Rustic', 'Mood', { warmth: 20, saturation: -20, fade: 15, clarity: 15, vignette: 25 }),
  f('sunset', 'Sunset', 'Mood', { warmth: 30, tint: 12, saturation: 20, overlayColor: '#ff8a5b', overlayAmount: 25 }),
  f('rainy', 'Rainy day', 'Mood', { warmth: -20, saturation: -30, contrast: -5, fade: 15 }),
  f('candy', 'Candy', 'Mood', { saturation: 30, tint: 15, exposure: 8, hsl_red_h: -10, hsl_blue_h: 15 }),
  f('neon', 'Neon', 'Mood', { saturation: 45, contrast: 25, hsl_purple_s: 40, hsl_magenta_s: 40, exposure: -5 }),
  f('muted', 'Muted', 'Mood', { saturation: -35, fade: 15, contrast: -8 }),
  f('earthy', 'Earthy', 'Mood', { hsl_green_h: -20, hsl_green_s: -25, warmth: 15, saturation: -10 }),
  f('dusk', 'Dusk', 'Mood', { exposure: -8, splitHighHue: 280, splitHighSat: 30, splitShadowHue: 230, splitShadowSat: 35 }),
];

const PORTRAIT = [
  f('softskin', 'Soft skin', 'Portrait', { denoise: 40, clarity: -20, exposure: 5, warmth: 6 }),
  f('warmglow', 'Warm glow', 'Portrait', { warmth: 22, exposure: 8, shadows: 20, hsl_orange_l: 15 }),
  f('porcelain', 'Porcelain', 'Portrait', { exposure: 12, hsl_orange_s: -25, hsl_orange_l: 20, contrast: -5 }),
  f('bronze', 'Bronze', 'Portrait', { warmth: 25, hsl_orange_s: 20, hsl_orange_l: -10, contrast: 12 }),
  f('natural', 'Natural', 'Portrait', { vibrance: 12, shadows: 12, clarity: 5 }),
  f('studio', 'Studio', 'Portrait', { contrast: 15, clarity: 15, highlights: -15, whites: 10 }),
  f('rosy', 'Rosy', 'Portrait', { tint: 15, hsl_red_s: 15, exposure: 5, warmth: 5 }),
  f('coolpro', 'Cool pro', 'Portrait', { warmth: -12, contrast: 10, clarity: 10, saturation: -5 }),
];

const NATURE = [
  f('foliage', 'Lush foliage', 'Nature', { hsl_green_s: 35, hsl_yellow_s: 20, clarity: 15, vibrance: 15 }),
  f('ocean', 'Ocean blue', 'Nature', { hsl_aqua_s: 35, hsl_blue_s: 30, hsl_blue_l: -10, clarity: 10 }),
  f('snow', 'Fresh snow', 'Nature', { exposure: 12, warmth: -18, whites: 20, clarity: 10 }),
  f('autumn', 'Autumn', 'Nature', { hsl_green_h: -30, hsl_orange_s: 30, hsl_yellow_s: 20, warmth: 15 }),
  f('spring', 'Spring', 'Nature', { hsl_green_h: 10, hsl_green_s: 20, exposure: 8, tint: 5, vibrance: 15 }),
  f('skypop', 'Sky pop', 'Nature', { hsl_blue_s: 40, hsl_blue_l: -20, highlights: -30, clarity: 15 }),
  f('sand', 'Desert sand', 'Nature', { hsl_orange_s: 25, hsl_yellow_s: 15, warmth: 20, clarity: 20 }),
  f('nightsky', 'Night sky', 'Nature', { exposure: -5, warmth: -25, contrast: 20, clarity: 25, denoise: 30 }),
];

const BW = [
  f('bwclassic', 'Classic B&W', 'Black & white', { mono: 'grayscale', contrast: 12 }),
  f('bwhigh', 'High contrast', 'Black & white', { mono: 'grayscale', contrast: 55, clarity: 25 }),
  f('bwsoft', 'Soft B&W', 'Black & white', { mono: 'grayscale', contrast: -15, fade: 15 }),
  f('selenium', 'Selenium', 'Black & white', { duotoneDark: '#1c1420', duotoneLight: '#f2e6dc', duotoneAmount: 100, contrast: 15 }),
  f('platinum', 'Platinum', 'Black & white', { duotoneDark: '#232121', duotoneLight: '#eee8dc', duotoneAmount: 100, fade: 8 }),
  f('bwinfrared', 'Infrared B&W', 'Black & white', { mono: 'grayscale', hsl_green_l: 60, hsl_blue_l: -50, contrast: 20 }),
  f('bwgrain', 'Grainy B&W', 'Black & white', { mono: 'grayscale', contrast: 25, grain: 45 }),
  f('lowkey', 'Low key', 'Black & white', { mono: 'grayscale', exposure: -20, contrast: 40, vignette: 45 }),
];

const DUOTONE_PAIRS = [
  ['Midnight', '#0b1d51', '#ffcf6b'], ['Sunburst', '#5a1a00', '#ffe28a'], ['Ocean', '#01295f', '#79d7ff'], ['Forest', '#0f2e1d', '#c8f59a'],
  ['Berry', '#3a0a3c', '#ff9fd1'], ['Grape', '#2b0f54', '#ffb3a7'], ['Mint', '#063b37', '#d6ffe9'], ['Lava', '#1a0000', '#ff5e3a'],
  ['Lemonade', '#1f3b73', '#fff36b'], ['Coral reef', '#0b3954', '#ff7f6b'], ['Blush', '#4b1d3f', '#ffd1dc'], ['Denim', '#10263f', '#a7c5eb'],
  ['Espresso', '#2b1b12', '#e9d2b4'], ['Neon city', '#12003a', '#00f5d4'], ['Cyber', '#1b0033', '#ff00c8'], ['Pine', '#0d2b20', '#f6e7b4'],
  ['Rust', '#2e0f05', '#f2a65a'], ['Lilac', '#241a3a', '#d7c3ff'], ['Steel', '#1b262c', '#bbe1fa'], ['Peach', '#44254a', '#ffcfa3'],
  ['Emerald', '#002b1f', '#5ef2a4'], ['Ruby', '#300010', '#ff8fa3'], ['Sapphire', '#00174f', '#8fb8ff'], ['Amber', '#311b00', '#ffc857'],
  ['Arcade', '#1a1446', '#ff6ad5'], ['Tropical', '#014d4e', '#ffd56b'], ['Vintage', '#3b2f2f', '#f3e1c7'], ['Ice', '#0d1b2a', '#e0fbfc'],
  ['Magma', '#200122', '#f5a623'], ['Olive', '#1f2610', '#e2e7b4'],
];

const TINTS = [
  ['Rose', '#ff6b8b'], ['Peach', '#ffab76'], ['Honey', '#f4c542'], ['Lime', '#b5e655'], ['Jade', '#3ccf91'], ['Aqua', '#39c5d6'],
  ['Sky', '#5aa9ff'], ['Indigo', '#6c63ff'], ['Violet', '#a45bff'], ['Orchid', '#e05bd9'], ['Crimson', '#e03a3a'], ['Tangerine', '#ff7a1a'],
  ['Sepia gold', '#c9a063'], ['Olive', '#8a9a3b'], ['Slate', '#6b7f99'], ['Lavender', '#b8a6ff'],
];

export const FILTER_LIBRARY = [
  ...FILTER_PRESETS.map((p) => ({ ...p, group: 'Basic' })),
  ...FILM,
  ...CINEMATIC,
  ...MOOD,
  ...PORTRAIT,
  ...NATURE,
  ...BW,
  ...DUOTONE_PAIRS.map(([label, dark, light]) =>
    f(`duo-${label.toLowerCase().replace(/\s+/g, '-')}`, label, 'Duotone', { duotoneDark: dark, duotoneLight: light, duotoneAmount: 100, contrast: 10 })
  ),
  ...TINTS.map(([label, color]) => f(`tint-${label.toLowerCase().replace(/\s+/g, '-')}`, label, 'Colour tint', { overlayColor: color, overlayAmount: 40 })),
];

export const FILTER_GROUPS = [...new Set(FILTER_LIBRARY.map((p) => p.group))];

// A cheap CSS approximation used only for the little swatches in the picker.
export function filterSwatchStyle(p) {
  const a = p.adjust;
  const parts = [];
  if (a.mono === 'grayscale') parts.push('grayscale(1)');
  if (a.mono === 'sepia') parts.push('sepia(1)');
  if (a.saturation) parts.push(`saturate(${1 + a.saturation / 100})`);
  if (a.contrast) parts.push(`contrast(${1 + a.contrast / 150})`);
  if (a.exposure) parts.push(`brightness(${1 + a.exposure / 120})`);
  if (a.warmth > 0) parts.push(`sepia(${a.warmth / 150})`);
  if (a.warmth < 0) parts.push(`hue-rotate(${a.warmth / 3}deg)`);
  const style = { filter: parts.join(' ') || 'none' };
  if (a.duotoneDark) style.background = `linear-gradient(135deg, ${a.duotoneDark}, ${a.duotoneLight})`;
  else if (a.overlayColor) style.background = `linear-gradient(135deg, ${a.overlayColor}aa, #f7b267 55%, ${a.overlayColor})`;
  return style;
}

// ---------------- Frames ----------------
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const FRAMES = [
  { id: 'border', label: 'Solid border', color: true },
  { id: 'mat', label: 'Gallery mat', color: true },
  { id: 'polaroid', label: 'Polaroid', color: true },
  { id: 'double', label: 'Double line', color: true },
  { id: 'inset', label: 'Inset line', color: true },
  { id: 'rounded', label: 'Rounded corners' },
  { id: 'circle', label: 'Circle' },
  { id: 'shadow', label: 'Drop shadow', color: true },
  { id: 'film', label: 'Film strip' },
  { id: 'fade', label: 'Soft edges', color: true },
];

// size: 0..100 (relative thickness). Returns a new canvas.
export function applyFrame(src, id, { color = '#ffffff', size = 40 } = {}) {
  const w = src.width;
  const h = src.height;
  const m = Math.min(w, h);
  const t = Math.max(2, Math.round((size / 100) * m * 0.12));
  let out;
  let ctx;
  const fresh = (cw, ch, fill) => {
    out = makeCanvas(cw, ch);
    ctx = out.getContext('2d');
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, cw, ch);
    }
  };
  switch (id) {
    case 'border':
      fresh(w + t * 2, h + t * 2, color);
      ctx.drawImage(src, t, t);
      break;
    case 'mat':
      fresh(w + t * 4, h + t * 4, color);
      ctx.drawImage(src, t * 2, t * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(1, t / 12);
      ctx.strokeRect(t * 2 - ctx.lineWidth, t * 2 - ctx.lineWidth, w + ctx.lineWidth * 2, h + ctx.lineWidth * 2);
      break;
    case 'polaroid':
      fresh(w + t * 2, h + t * 6, color);
      ctx.drawImage(src, t, t);
      break;
    case 'double': {
      fresh(w, h);
      ctx.drawImage(src, 0, 0);
      ctx.strokeStyle = color;
      const lw = Math.max(2, t / 4);
      ctx.lineWidth = lw;
      ctx.strokeRect(t / 2, t / 2, w - t, h - t);
      ctx.strokeRect(t, t, w - t * 2, h - t * 2);
      break;
    }
    case 'inset':
      fresh(w, h);
      ctx.drawImage(src, 0, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, t / 3);
      ctx.strokeRect(t, t, w - t * 2, h - t * 2);
      break;
    case 'rounded':
      fresh(w, h);
      roundRectPath(ctx, 0, 0, w, h, Math.max(4, (size / 100) * m * 0.25));
      ctx.clip();
      ctx.drawImage(src, 0, 0);
      break;
    case 'circle':
      fresh(m, m);
      ctx.beginPath();
      ctx.arc(m / 2, m / 2, m / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(src, (m - w) / 2, (m - h) / 2);
      break;
    case 'shadow':
      fresh(w + t * 4, h + t * 4, color);
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = t * 1.2;
      ctx.shadowOffsetY = t * 0.35;
      ctx.drawImage(src, t * 2, t * 2);
      break;
    case 'film': {
      const band = Math.max(12, Math.round(m * 0.09));
      fresh(w, h + band * 2, '#111');
      ctx.drawImage(src, 0, band);
      ctx.fillStyle = '#f4f1ea';
      const hole = band * 0.42;
      for (let x = band * 0.3; x < w; x += band * 0.9) {
        roundRectPath(ctx, x, (band - hole) / 2, hole * 1.3, hole, hole * 0.2);
        ctx.fill();
        roundRectPath(ctx, x, h + band + (band - hole) / 2, hole * 1.3, hole, hole * 0.2);
        ctx.fill();
      }
      break;
    }
    case 'fade': {
      fresh(w, h);
      ctx.drawImage(src, 0, 0);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.5 - size / 400), w / 2, h / 2, Math.hypot(w, h) / 2);
      g.addColorStop(0, `${color}00`);
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    default:
      return src;
  }
  return out;
}

// ---------------- Text & stickers ----------------
export const FONTS = [
  { id: 'IBM Plex Sans', label: 'Plex Sans' },
  { id: 'Arial', label: 'Arial' },
  { id: 'Helvetica Neue', label: 'Helvetica' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Times New Roman', label: 'Times' },
  { id: 'Impact', label: 'Impact' },
  { id: 'Arial Black', label: 'Arial Black' },
  { id: 'Trebuchet MS', label: 'Trebuchet' },
  { id: 'Verdana', label: 'Verdana' },
  { id: 'Courier New', label: 'Courier' },
  { id: 'IBM Plex Mono', label: 'Plex Mono' },
  { id: 'Brush Script MT', label: 'Brush Script' },
  { id: 'Comic Sans MS', label: 'Comic' },
  { id: 'Palatino', label: 'Palatino' },
];

export const STICKERS = [
  '😀', '😂', '😍', '🥰', '😎', '🤩', '😜', '🤔', '😴', '🥳', '😇', '🤯',
  '❤️', '💖', '💯', '✨', '⭐', '🌟', '🔥', '⚡', '🌈', '☀️', '🌙', '❄️',
  '🎉', '🎂', '🎁', '🎈', '🏆', '👑', '💎', '🎵', '📸', '✈️', '🚀', '🏖️',
  '🌸', '🌻', '🌿', '🍀', '🍕', '☕', '🐶', '🐱', '🦋', '👍', '👏', '✅',
];

// All sizes are fractions of the image so text looks the same at any resolution.
export function drawTextOnCanvas(src, o) {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const px = Math.max(8, Math.round(o.size * Math.min(src.width, src.height)));
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${px}px "${o.font}", sans-serif`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  const lines = String(o.text || '').split('\n');
  const lh = px * 1.2;
  const x = o.x * src.width;
  let y = o.y * src.height - ((lines.length - 1) * lh) / 2;
  if (o.background) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = px * 0.35;
    const left = ctx.textAlign === 'center' ? x - widest / 2 : ctx.textAlign === 'right' ? x - widest : x;
    ctx.fillStyle = o.background;
    roundRectPath(ctx, left - pad, y - lh / 2 - pad / 2, widest + pad * 2, lh * lines.length + pad, pad * 0.6);
    ctx.fill();
  }
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = px * 0.18;
    ctx.shadowOffsetY = px * 0.06;
  }
  for (const line of lines) {
    if (o.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, (o.strokeWidth / 100) * px * 0.25);
      ctx.strokeStyle = o.strokeColor || '#000';
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.fillText(line, x, y);
    y += lh;
  }
  return out;
}

// ---------------- Size presets ----------------
export const SIZE_PRESETS = [
  { label: 'Instagram post', w: 1080, h: 1080 },
  { label: 'Instagram portrait', w: 1080, h: 1350 },
  { label: 'Instagram / WhatsApp story', w: 1080, h: 1920 },
  { label: 'Facebook post', w: 1200, h: 630 },
  { label: 'Facebook cover', w: 820, h: 312 },
  { label: 'YouTube thumbnail', w: 1280, h: 720 },
  { label: 'YouTube banner', w: 2560, h: 1440 },
  { label: 'X / Twitter post', w: 1600, h: 900 },
  { label: 'X / Twitter header', w: 1500, h: 500 },
  { label: 'LinkedIn post', w: 1200, h: 627 },
  { label: 'LinkedIn banner', w: 1584, h: 396 },
  { label: 'Pinterest pin', w: 1000, h: 1500 },
  { label: 'Profile picture', w: 800, h: 800 },
  { label: 'Passport photo (35×45)', w: 413, h: 531 },
  { label: 'A4 print (300 dpi)', w: 2480, h: 3508 },
  { label: 'Desktop wallpaper 4K', w: 3840, h: 2160 },
  { label: 'Phone wallpaper', w: 1170, h: 2532 },
];

export const BRUSH_TOOLS = [
  { id: 'brush', label: 'Paint', icon: 'fa-solid fa-paintbrush' },
  { id: 'eraser', label: 'Erase', icon: 'fa-solid fa-eraser' },
  { id: 'blur', label: 'Blur', icon: 'fa-solid fa-droplet' },
  { id: 'pixelate', label: 'Pixelate', icon: 'fa-solid fa-chess-board' },
  { id: 'dodge', label: 'Lighten', icon: 'fa-solid fa-sun' },
  { id: 'burn', label: 'Darken', icon: 'fa-solid fa-moon' },
  { id: 'picker', label: 'Pick colour', icon: 'fa-solid fa-eye-dropper' },
];

// The "paint source" for a brush stroke: the look you paint with.
export function brushSource(base, tool, color) {
  const c = makeCanvas(base.width, base.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (tool === 'brush') {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  ctx.drawImage(base, 0, 0);
  if (tool === 'blur' || tool === 'pixelate') {
    const effect = tool === 'blur' ? { apply: (img) => gaussianBlur(img, Math.max(3, Math.max(c.width, c.height) / 150)) } : EFFECTS.find((e) => e.id === 'pixelate');
    return applyEffectToCanvas(c, effect, 35);
  }
  if (tool === 'dodge' || tool === 'burn') {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const k = tool === 'dodge' ? 1.35 : 0.65;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] * k + (tool === 'dodge' ? 10 : 0));
      d[i + 1] = clamp(d[i + 1] * k + (tool === 'dodge' ? 10 : 0));
      d[i + 2] = clamp(d[i + 2] * k + (tool === 'dodge' ? 10 : 0));
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

export const MIX_ADJUST_COUNT = 3; // red / green / blue channel sliders
export const SPLIT_TONE_COUNT = 5;
