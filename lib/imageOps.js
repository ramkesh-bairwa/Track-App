// Pixel operations for the photo editor. Everything runs in the browser on
// canvases / ImageData — photos are never uploaded anywhere.

export const DEFAULT_ADJUST = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  hue: 0,
  clarity: 0,
  sharpness: 0,
  denoise: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  fade: 0,
  mono: 'none', // none | grayscale | sepia
  // Channel mixer
  red: 0,
  green: 0,
  blue: 0,
  // Split toning
  splitHighHue: 40,
  splitHighSat: 0,
  splitShadowHue: 210,
  splitShadowSat: 0,
  splitBalance: 0,
  // Per-colour hue / saturation / luminance, e.g. hsl_blue_s
  ...Object.fromEntries(
    ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'].flatMap((c) => [
      [`hsl_${c}_h`, 0],
      [`hsl_${c}_s`, 0],
      [`hsl_${c}_l`, 0],
    ])
  ),
  // Colour effects set by filters: duotone (two colours mapped to dark/light)
  // and a flat colour overlay.
  duotoneDark: '',
  duotoneLight: '',
  duotoneAmount: 0,
  overlayColor: '',
  overlayAmount: 0,
};

export const HSL_COLORS = [
  { id: 'red', label: 'Red', hue: 0, swatch: '#e5484d' },
  { id: 'orange', label: 'Orange', hue: 30, swatch: '#f08c2e' },
  { id: 'yellow', label: 'Yellow', hue: 58, swatch: '#f2cf3a' },
  { id: 'green', label: 'Green', hue: 120, swatch: '#46a758' },
  { id: 'aqua', label: 'Aqua', hue: 180, swatch: '#29b6c6' },
  { id: 'blue', label: 'Blue', hue: 225, swatch: '#3e63dd' },
  { id: 'purple', label: 'Purple', hue: 275, swatch: '#8e4ec6' },
  { id: 'magenta', label: 'Magenta', hue: 320, swatch: '#d6409f' },
];

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// W3C soft-light blend of base `a` with colour `c` (both 0..1).
function softLight(a, c) {
  const v = a < 0 ? 0 : a > 1 ? 1 : a;
  if (c <= 0.5) return v - (1 - 2 * c) * v * (1 - v);
  const d = v <= 0.25 ? ((16 * v - 12) * v + 4) * v : Math.sqrt(v);
  return v + (2 * c - 1) * (d - v);
}

function hslToRgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

export const ADJUST_GROUPS = [
  {
    label: 'Light',
    items: [
      ['exposure', 'Exposure', -100, 100],
      ['brightness', 'Brightness', -100, 100],
      ['contrast', 'Contrast', -100, 100],
      ['highlights', 'Highlights', -100, 100],
      ['shadows', 'Shadows', -100, 100],
      ['whites', 'Whites', -100, 100],
      ['blacks', 'Blacks', -100, 100],
    ],
  },
  {
    label: 'Color',
    items: [
      ['saturation', 'Saturation', -100, 100],
      ['vibrance', 'Vibrance', -100, 100],
      ['warmth', 'Warmth', -100, 100],
      ['tint', 'Tint', -100, 100],
      ['hue', 'Hue', -180, 180],
    ],
  },
  {
    label: 'Detail',
    items: [
      ['clarity', 'Clarity', 0, 100],
      ['sharpness', 'Sharpness', 0, 100],
      ['denoise', 'Noise reduction', 0, 100],
      ['blur', 'Blur', 0, 100],
    ],
  },
  {
    label: 'Effects',
    items: [
      ['vignette', 'Vignette', -100, 100],
      ['grain', 'Grain', 0, 100],
      ['fade', 'Fade', 0, 100],
    ],
  },
];

export const FILTER_PRESETS = [
  { id: 'none', label: 'Original', adjust: {} },
  { id: 'vivid', label: 'Vivid', adjust: { contrast: 18, saturation: 25, vibrance: 20, clarity: 15 } },
  { id: 'warm', label: 'Warm', adjust: { warmth: 35, saturation: 8, exposure: 4 } },
  { id: 'cool', label: 'Cool', adjust: { warmth: -30, tint: -5, contrast: 8 } },
  { id: 'portrait', label: 'Portrait', adjust: { exposure: 6, shadows: 20, warmth: 10, clarity: -10, denoise: 25, vibrance: 10 } },
  { id: 'landscape', label: 'Landscape', adjust: { clarity: 35, vibrance: 35, highlights: -25, shadows: 20, sharpness: 20 } },
  { id: 'hdr', label: 'HDR', adjust: { highlights: -55, shadows: 55, clarity: 45, vibrance: 25, contrast: 10 } },
  { id: 'vintage', label: 'Vintage', adjust: { warmth: 25, fade: 35, contrast: -12, saturation: -25, grain: 25, vignette: 30 } },
  { id: 'film', label: 'Film', adjust: { fade: 20, contrast: 12, warmth: 8, grain: 18, tint: 6 } },
  { id: 'matte', label: 'Matte', adjust: { fade: 45, contrast: -18, saturation: -10 } },
  { id: 'bw', label: 'B&W', adjust: { mono: 'grayscale', contrast: 18, clarity: 15 } },
  { id: 'noir', label: 'Noir', adjust: { mono: 'grayscale', contrast: 55, blacks: -30, vignette: 45, grain: 12 } },
  { id: 'sepia', label: 'Sepia', adjust: { mono: 'sepia', contrast: 8, fade: 12 } },
  { id: 'dramatic', label: 'Dramatic', adjust: { contrast: 35, highlights: -40, shadows: -10, clarity: 40, saturation: -15, vignette: 35 } },
];

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ---------- blur helpers (separable box blur, O(n) per pass) ----------
function boxBlurChannel(src, dst, w, h, r) {
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) acc += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc / div;
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

function boxBlurVertical(src, dst, w, h, r) {
  const div = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let acc = src[x] * (r + 1);
    for (let y = 1; y <= r; y++) acc += src[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / div;
      acc += src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
    }
  }
}

// Approximate gaussian: 3 box passes. Returns blurred copies of R, G, B.
function blurRGB(data, w, h, radius) {
  const n = w * h;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const tmp = new Float32Array(n);
  const r = Math.max(1, Math.round(radius));
  for (let c = 0; c < 3; c++) {
    const ch = out[c];
    for (let i = 0; i < n; i++) ch[i] = data[i * 4 + c];
    for (let pass = 0; pass < 3; pass++) {
      boxBlurChannel(ch, tmp, w, h, r);
      boxBlurVertical(tmp, ch, w, h, r);
    }
  }
  return out;
}

// Unsharp mask: out = orig + amount * (orig - blur). `threshold` skips flat
// areas so noise isn't sharpened into grit.
export function unsharpMask(img, amount, radius, threshold = 0) {
  if (amount <= 0) return img;
  const { data, width: w, height: h } = img;
  const blurred = blurRGB(data, w, h, radius);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[c][p];
      if (Math.abs(diff) >= threshold) data[i + c] = clamp255(data[i + c] + amount * diff);
    }
  }
  return img;
}

export function gaussianBlur(img, radius, mix = 1) {
  if (radius <= 0 || mix <= 0) return img;
  const { data, width: w, height: h } = img;
  const blurred = blurRGB(data, w, h, radius);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (blurred[c][p] - data[i + c]) * mix;
  }
  return img;
}

// Edge-aware smoothing: blend toward the blurred image only where the pixel
// is close to its neighbourhood (flat areas = noise), keeping edges crisp.
export function denoise(img, strength) {
  if (strength <= 0) return img;
  const { data, width: w, height: h } = img;
  const radius = 1 + Math.round(strength / 40);
  const blurred = blurRGB(data, w, h, radius);
  const tol = 6 + strength * 0.5;
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const d = Math.abs(data[i] - blurred[0][p]) + Math.abs(data[i + 1] - blurred[1][p]) + Math.abs(data[i + 2] - blurred[2][p]);
    const k = Math.max(0, 1 - d / (tol * 3)) * Math.min(1, strength / 60);
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (blurred[c][p] - data[i + c]) * k;
  }
  return img;
}

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
}

// All the slider adjustments, in a fixed, photographic order.
export function applyAdjustments(img, adj, { seed = 1 } = {}) {
  const a = { ...DEFAULT_ADJUST, ...adj };
  const { data, width: w, height: h } = img;

  if (a.denoise > 0) denoise(img, a.denoise);
  if (a.blur > 0) gaussianBlur(img, 1 + (a.blur / 100) * Math.max(w, h) * 0.012);

  const expo = Math.pow(2, (a.exposure / 100) * 1.5);
  const bright = (a.brightness / 100) * 0.35;
  const cf = Math.tan(((a.contrast / 100) * 0.9 + 1) * (Math.PI / 4));
  const sat = 1 + a.saturation / 100;
  const vib = a.vibrance / 100;
  const warm = (a.warmth / 100) * 0.12;
  const tint = (a.tint / 100) * 0.08;
  const hl = a.highlights / 100;
  const sh = a.shadows / 100;
  const wh = a.whites / 100;
  const bl = a.blacks / 100;
  const fade = (a.fade / 100) * 0.22;
  const hm = a.hue ? hueMatrix(a.hue) : null;
  const gainR = 1 + a.red / 200;
  const gainG = 1 + a.green / 200;
  const gainB = 1 + a.blue / 200;
  const hslActive = HSL_COLORS.filter((c) => a[`hsl_${c.id}_h`] || a[`hsl_${c.id}_s`] || a[`hsl_${c.id}_l`]).map((c) => ({
    hue: c.hue,
    dh: a[`hsl_${c.id}_h`] / 100,
    ds: a[`hsl_${c.id}_s`] / 100,
    dl: a[`hsl_${c.id}_l`] / 100,
  }));
  const splitOn = a.splitHighSat > 0 || a.splitShadowSat > 0;
  const splitHigh = hslToRgb(a.splitHighHue / 360, 1, 0.5);
  const splitShadow = hslToRgb(a.splitShadowHue / 360, 1, 0.5);
  const duoDark = a.duotoneAmount > 0 ? hexToRgb01(a.duotoneDark) : null;
  const duoLight = a.duotoneAmount > 0 ? hexToRgb01(a.duotoneLight) : null;
  const duoK = a.duotoneAmount / 100;
  const ovColor = a.overlayAmount > 0 ? hexToRgb01(a.overlayColor) : null;
  const ovK = a.overlayAmount / 100;
  const vig = a.vignette / 100;
  const grain = (a.grain / 100) * 0.12;
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  let rnd = seed * 9301 + 49297;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      r *= expo * gainR; g *= expo * gainG; b *= expo * gainB;
      r += bright; g += bright; b += bright;

      // Tone regions by luminance.
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lc = l < 0 ? 0 : l > 1 ? 1 : l;
      const tone =
        hl * 0.35 * lc * lc * (lc > 0.5 ? 1 : lc * 2) +
        sh * 0.35 * (1 - lc) * (1 - lc) * (lc < 0.5 ? 1 : (1 - lc) * 2) +
        wh * 0.25 * Math.pow(lc, 4) +
        bl * 0.25 * Math.pow(1 - lc, 4);
      r += tone; g += tone; b += tone;

      r = (r - 0.5) * cf + 0.5;
      g = (g - 0.5) * cf + 0.5;
      b = (b - 0.5) * cf + 0.5;

      r += warm; b -= warm;
      g -= tint; r += tint * 0.5; b += tint * 0.5;

      if (hm) {
        const nr = r * hm[0] + g * hm[1] + b * hm[2];
        const ng = r * hm[3] + g * hm[4] + b * hm[5];
        const nb = r * hm[6] + g * hm[7] + b * hm[8];
        r = nr; g = ng; b = nb;
      }

      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let s = sat;
      if (vib) {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const curSat = mx - mn;
        s *= 1 + vib * (1 - Math.min(1, curSat * 1.5));
      }
      r = gray + (r - gray) * s;
      g = gray + (g - gray) * s;
      b = gray + (b - gray) * s;

      // Per-colour HSL: each pixel is nudged by the colour bands its hue falls in.
      if (hslActive.length) {
        const cr = r < 0 ? 0 : r > 1 ? 1 : r;
        const cg = g < 0 ? 0 : g > 1 ? 1 : g;
        const cb = b < 0 ? 0 : b > 1 ? 1 : b;
        const mx = Math.max(cr, cg, cb);
        const mn = Math.min(cr, cg, cb);
        const d = mx - mn;
        if (d > 0.02) {
          let hh;
          if (mx === cr) hh = ((cg - cb) / d) % 6;
          else if (mx === cg) hh = (cb - cr) / d + 2;
          else hh = (cr - cg) / d + 4;
          hh *= 60;
          if (hh < 0) hh += 360;
          let ll = (mx + mn) / 2;
          let ss = d / (1 - Math.abs(2 * ll - 1));
          let dh = 0;
          let ds = 0;
          let dl = 0;
          for (const c of hslActive) {
            let dist = Math.abs(hh - c.hue);
            if (dist > 180) dist = 360 - dist;
            const wgt = Math.max(0, 1 - dist / 40);
            if (wgt) {
              dh += c.dh * wgt;
              ds += c.ds * wgt;
              dl += c.dl * wgt;
            }
          }
          if (dh || ds || dl) {
            hh = (hh + dh * 30 + 360) % 360;
            ss = Math.min(1, Math.max(0, ss * (1 + ds)));
            ll = Math.min(1, Math.max(0, ll + dl * 0.25 * Math.min(1, ss * 2)));
            [r, g, b] = hslToRgb(hh / 360, ss, ll);
          }
        }
      }

      if (a.mono === 'grayscale') {
        const m = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = g = b = m;
      } else if (a.mono === 'sepia') {
        const nr = r * 0.393 + g * 0.769 + b * 0.189;
        const ng = r * 0.349 + g * 0.686 + b * 0.168;
        const nb = r * 0.272 + g * 0.534 + b * 0.131;
        r = nr; g = ng; b = nb;
      }

      if (splitOn) {
        const lum = Math.min(1, Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b));
        const pivot = 0.5 + a.splitBalance / 200;
        const hiW = lum > pivot ? ((lum - pivot) / (1 - pivot)) * (a.splitHighSat / 100) * 0.35 : 0;
        const shW = lum < pivot ? ((pivot - lum) / pivot) * (a.splitShadowSat / 100) * 0.35 : 0;
        r += (splitHigh[0] - 0.5) * hiW + (splitShadow[0] - 0.5) * shW;
        g += (splitHigh[1] - 0.5) * hiW + (splitShadow[1] - 0.5) * shW;
        b += (splitHigh[2] - 0.5) * hiW + (splitShadow[2] - 0.5) * shW;
      }

      if (duoDark && duoLight) {
        const lum = Math.min(1, Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b));
        r = r * (1 - duoK) + (duoDark[0] + (duoLight[0] - duoDark[0]) * lum) * duoK;
        g = g * (1 - duoK) + (duoDark[1] + (duoLight[1] - duoDark[1]) * lum) * duoK;
        b = b * (1 - duoK) + (duoDark[2] + (duoLight[2] - duoDark[2]) * lum) * duoK;
      }

      if (ovColor) {
        // Soft-light tint: colours the photo but keeps its light and shade.
        r += (softLight(r, ovColor[0]) - r) * ovK;
        g += (softLight(g, ovColor[1]) - g) * ovK;
        b += (softLight(b, ovColor[2]) - b) * ovK;
      }

      if (fade) {
        r = r * (1 - fade) + fade * 0.6;
        g = g * (1 - fade) + fade * 0.6;
        b = b * (1 - fade) + fade * 0.62;
      }

      if (vig) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / maxD;
        const f = Math.pow(Math.max(0, d - 0.35) / 0.65, 2);
        const k = vig > 0 ? 1 - vig * f * 0.85 : 1 + -vig * f * 0.6;
        r *= k; g *= k; b *= k;
        if (vig < 0) { r = Math.min(r, 1); g = Math.min(g, 1); b = Math.min(b, 1); }
      }

      if (grain) {
        rnd = (rnd * 16807) % 2147483647;
        const n = ((rnd / 2147483647) - 0.5) * grain;
        r += n; g += n; b += n;
      }

      data[i] = clamp255(r * 255);
      data[i + 1] = clamp255(g * 255);
      data[i + 2] = clamp255(b * 255);
    }
  }

  // Clarity = large-radius local contrast; sharpness = small-radius detail.
  if (a.clarity > 0) unsharpMask(img, (a.clarity / 100) * 0.6, Math.max(4, Math.round(Math.max(w, h) / 90)), 2);
  if (a.clarity < 0) gaussianBlur(img, Math.max(2, Math.round(Math.max(w, h) / 200)), (-a.clarity / 100) * 0.5);
  if (a.sharpness > 0) unsharpMask(img, (a.sharpness / 100) * 1.4, 1, 3);
  return img;
}

// Per-channel levels stretch, ignoring the darkest/brightest 0.5% (so a few
// stray pixels don't stop the stretch). The core of "Auto enhance".
export function autoLevels(img, clip = 0.005) {
  const { data } = img;
  const n = data.length / 4;
  const lo = [0, 0, 0];
  const hi = [255, 255, 255];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = c; i < data.length; i += 4) hist[data[i]]++;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * clip) { lo[c] = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * clip) { hi[c] = v; break; } }
  }
  // Link channels partially so colour casts are corrected but not overdone.
  const loAll = Math.min(...lo);
  const hiAll = Math.max(...hi);
  for (let c = 0; c < 3; c++) {
    const l = (lo[c] + loAll) / 2;
    const h = Math.max(l + 16, (hi[c] + hiAll) / 2);
    const scale = 255 / (h - l);
    for (let i = c; i < data.length; i += 4) data[i] = clamp255((data[i] - l) * scale);
  }
  return img;
}

// Mean luminance 0..1 — used by auto enhance to lift dark photos.
export function meanLuminance(img) {
  const { data } = img;
  let sum = 0;
  const step = Math.max(4, Math.floor(data.length / 4 / 50000) * 4);
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    count++;
  }
  return sum / count / 255;
}

// Enlarges in ≤2× steps with high-quality smoothing (sharper than one big
// jump), then restores edge crispness with an unsharp mask. It makes a small
// or soft photo bigger and clearer; it can't invent detail like an AI model.
export function upscaleCanvas(src, factor) {
  let cur = src;
  let w = src.width;
  let h = src.height;
  const targetW = Math.round(src.width * factor);
  const targetH = Math.round(src.height * factor);
  while (w < targetW) {
    w = Math.min(targetW, w * 2);
    h = Math.min(targetH, Math.round(h * 2));
    if (w === targetW) h = targetH;
    const next = makeCanvas(w, h);
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    cur = next;
  }
  const ctx = cur.getContext('2d');
  const img = ctx.getImageData(0, 0, cur.width, cur.height);
  denoise(img, 18);
  unsharpMask(img, 0.9, Math.max(1, Math.round(factor / 1.5)), 2);
  unsharpMask(img, 0.35, 1, 1);
  ctx.putImageData(img, 0, 0);
  return cur;
}

export function resizeCanvas(src, w, h) {
  let cur = src;
  // Downscale in halves for quality, then one final step.
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const half = makeCanvas(cur.width / 2, cur.height / 2);
    const ctx = half.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  // Enlarging goes through the upscaler (stepped + sharpened) first.
  if (w > cur.width || h > cur.height) cur = upscaleCanvas(cur, Math.max(w / cur.width, h / cur.height));
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

export function rotateCanvas(src, dir) {
  const out = makeCanvas(src.height, src.width);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

export function straightenCanvas(src, degrees) {
  if (!degrees) return cloneCanvas(src);
  const a = (degrees * Math.PI) / 180;
  // Zoom in just enough that no empty corners show.
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const scale = Math.max((src.width * cos + src.height * sin) / src.width, (src.width * sin + src.height * cos) / src.height);
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(a);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

export function flipCanvas(src, horizontal) {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  if (horizontal) {
    ctx.translate(src.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, src.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

// rect in 0..1 fractions of the image.
export function cropCanvas(src, rect) {
  const x = Math.round(rect.x * src.width);
  const y = Math.round(rect.y * src.height);
  const w = Math.max(1, Math.round(rect.w * src.width));
  const h = Math.max(1, Math.round(rect.h * src.height));
  const out = makeCanvas(w, h);
  out.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return out;
}
