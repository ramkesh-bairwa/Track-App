// Applies a user-chosen background color to a chrome region (sidebar/topbar)
// while keeping the text inside it readable, regardless of which theme
// (dark/light) is active — dark, mostly-opaque overrides of the same design
// tokens the rest of the app already reads via var(--text) etc.
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Returns a React style object (background + CSS custom property overrides)
// for a chrome element, or undefined to fall back to the theme default.
export function chromeColorStyle(hexColor) {
  if (!hexColor) return undefined;
  const rgb = hexToRgb(hexColor);
  if (!rgb) return undefined;
  const isLight = relativeLuminance(rgb) > 0.5;

  return isLight
    ? {
        background: hexColor,
        '--text': '#1a1d24',
        '--text-muted': '#5b6472',
        '--text-faint': '#8991a0',
        '--border': 'rgba(0, 0, 0, 0.14)',
        '--border-soft': 'rgba(0, 0, 0, 0.08)',
        '--panel-raised': 'rgba(0, 0, 0, 0.06)',
      }
    : {
        background: hexColor,
        '--text': '#e9ebef',
        '--text-muted': '#8b93a5',
        '--text-faint': '#5c6478',
        '--border': 'rgba(255, 255, 255, 0.16)',
        '--border-soft': 'rgba(255, 255, 255, 0.09)',
        '--panel-raised': 'rgba(255, 255, 255, 0.09)',
      };
}

// Blends a color toward white (amount 0–1), as an opaque hex.
function tint({ r, g, b }, amount) {
  const mix = (c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

// Blends a color toward black (amount 0–1), as an opaque hex.
function shade({ r, g, b }, amount) {
  const mix = (c) => Math.round(c * (1 - amount)).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

// The page background color: the theme tokens for the whole app (pages,
// popups and dropdowns), so a light color reads like the light theme and a
// dark one like the dark theme. The sidebar and top bar keep their own colors.
export function contentColorStyle(hexColor) {
  // Strict: the value ends up inside a <style> tag (contentColorCss).
  if (!/^#[0-9a-f]{6}$/i.test(hexColor || '')) return undefined;
  const rgb = hexToRgb(hexColor);
  if (!rgb) return undefined;
  const isLight = relativeLuminance(rgb) > 0.5;

  return isLight
    ? {
        '--bg': hexColor,
        '--panel': tint(rgb, 0.7),
        '--panel-raised': shade(rgb, 0.05),
        '--border': 'rgba(0, 0, 0, 0.13)',
        '--border-soft': 'rgba(0, 0, 0, 0.08)',
        '--text': '#1a1d24',
        '--text-muted': '#5b6472',
        '--text-faint': '#8991a0',
        '--accent': '#1f9d85',
        '--accent-dim': '#d3f3ea',
        '--accent-text': '#147a65',
        '--danger': '#c62f3a',
        '--danger-dim': '#fbe4e5',
      }
    : {
        '--bg': hexColor,
        '--panel': tint(rgb, 0.04),
        '--panel-raised': tint(rgb, 0.09),
        '--border': 'rgba(255, 255, 255, 0.12)',
        '--border-soft': 'rgba(255, 255, 255, 0.07)',
        '--text': '#e9ebef',
        '--text-muted': '#8b93a5',
        '--text-faint': '#5c6478',
        '--accent': '#35c2a6',
        '--accent-dim': '#23503f',
        '--accent-text': '#7fe0cc',
        '--danger': '#e5646b',
        '--danger-dim': '#3a2226',
      };
}

// The same, as a stylesheet for the server-rendered page. html:root[data-theme]
// outranks the light theme's own :root[data-theme='light'] tokens.
export function contentColorCss(hexColor) {
  const style = contentColorStyle(hexColor);
  if (!style) return '';
  const body = Object.entries(style).map(([k, v]) => `${k}:${v};`).join('');
  return `html:root,html:root[data-theme]{${body}}`;
}

const STYLE_KEYS = [
  'background', '--bg', '--panel', '--panel-raised', '--border', '--border-soft',
  '--text', '--text-muted', '--text-faint',
  '--accent', '--accent-dim', '--accent-text', '--danger', '--danger-dim',
];

// Live-preview helper: imperatively applies (or clears) a chrome color on
// real DOM nodes, so picking a color in the Appearance modal is reflected
// immediately in the actual sidebar/top bar/page behind it, before saving.
export function applyChromeColorLive(selector, hexColor, styleFor = chromeColorStyle) {
  if (typeof document === 'undefined') return;
  const style = styleFor(hexColor);
  document.querySelectorAll(selector).forEach((el) => {
    STYLE_KEYS.forEach((key) => {
      if (style && !(key in style)) return;
      if (!style) {
        el.style.removeProperty(key);
      } else if (key.startsWith('--')) {
        el.style.setProperty(key, style[key]);
      } else {
        el.style[key] = style[key];
      }
    });
  });
}
