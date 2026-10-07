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

const CHROME_STYLE_KEYS = [
  'background', '--text', '--text-muted', '--text-faint',
  '--border', '--border-soft', '--panel-raised',
];

// Live-preview helper: imperatively applies (or clears) a chrome color on
// real DOM nodes, so picking a color in the Appearance modal is reflected
// immediately in the actual sidebar/top bar behind it, before saving.
export function applyChromeColorLive(selector, hexColor) {
  if (typeof document === 'undefined') return;
  const style = chromeColorStyle(hexColor);
  document.querySelectorAll(selector).forEach((el) => {
    CHROME_STYLE_KEYS.forEach((key) => {
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
