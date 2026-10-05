// Guards for URLs that came from user data before they go into href/src.
// React 18 still renders `javascript:` URLs, so a stored value like
// "javascript:alert(document.cookie)" would run on click without these.

// Web / mail links and same-site paths only. Anything else → null.
export function safeLink(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return v;
  return null;
}

// A stored file (data: URL) for download links. Anything else → null.
export function safeFileUrl(value) {
  return typeof value === 'string' && /^data:[\w.+-]+\/[\w.+-]+[^,]*,/i.test(value.trim()) ? value.trim() : null;
}

// File types a browser can show without running anything. HTML, SVG, XML and
// scripts are opened as plain text instead, so they display their source.
export function isInertMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/svg+xml') return false;
  return /^(image|audio|video)\//.test(m) || m === 'application/pdf' || m === 'text/plain' || m === 'text/csv' || m === 'application/json';
}
