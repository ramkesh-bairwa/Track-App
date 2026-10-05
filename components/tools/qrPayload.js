// Builds the text a QR code carries for each content type. Kept free of React
// so the encodings are easy to check on their own.

// Wi‑Fi (ZXing "WIFI:" format): \ ; , : " must be backslash-escaped.
const wifiEscape = (s) => s.replace(/([\\;,:"])/g, '\\$1');
// vCard 3.0 text values: escape \ , ; and newlines.
const vcardEscape = (s) => s.replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

export const QR_TYPES = [
  { id: 'url', label: 'URL', icon: 'fa-link' },
  { id: 'text', label: 'Text', icon: 'fa-font' },
  { id: 'wifi', label: 'Wi‑Fi', icon: 'fa-wifi' },
  { id: 'email', label: 'Email', icon: 'fa-envelope' },
  { id: 'phone', label: 'Phone', icon: 'fa-phone' },
  { id: 'sms', label: 'SMS', icon: 'fa-comment-sms' },
  { id: 'contact', label: 'Contact', icon: 'fa-address-card' },
];

export const EMPTY_FORMS = {
  url: { url: '' },
  text: { text: '' },
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  email: { to: '', subject: '', body: '' },
  phone: { number: '' },
  sms: { number: '', message: '' },
  contact: { first: '', last: '', phone: '', email: '', org: '', url: '' },
};

// Phone numbers keep a leading + and digits only (spaces, dashes and
// brackets confuse some diallers).
const cleanPhone = (s) => {
  const t = s.trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/[^\d]/g, '');
};

const encodeMailbox = (s) => s.split(',').map((a) => encodeURIComponent(a.trim()).replace(/%40/g, '@')).filter(Boolean).join(',');

export function buildPayload(type, f) {
  switch (type) {
    case 'url': {
      const u = f.url.trim();
      if (!u) return '';
      // Bare domains get https:// so phones open them as links, not text.
      return /^[a-z][a-z\d+.-]*:/i.test(u) ? u : `https://${u}`;
    }
    case 'text':
      return f.text;
    case 'wifi': {
      if (!f.ssid) return '';
      const parts = [`T:${f.security === 'none' ? 'nopass' : f.security}`, `S:${wifiEscape(f.ssid)}`];
      if (f.security !== 'none' && f.password) parts.push(`P:${wifiEscape(f.password)}`);
      if (f.hidden) parts.push('H:true');
      return `WIFI:${parts.join(';')};;`;
    }
    case 'email': {
      if (!f.to.trim() && !f.subject && !f.body) return '';
      const q = [];
      if (f.subject) q.push(`subject=${encodeURIComponent(f.subject)}`);
      if (f.body) q.push(`body=${encodeURIComponent(f.body)}`);
      return `mailto:${encodeMailbox(f.to)}${q.length ? `?${q.join('&')}` : ''}`;
    }
    case 'phone': {
      const n = cleanPhone(f.number);
      return n ? `tel:${n}` : '';
    }
    case 'sms': {
      const n = cleanPhone(f.number);
      if (!n && !f.message) return '';
      return `SMSTO:${n}:${f.message}`;
    }
    case 'contact': {
      const first = f.first.trim();
      const last = f.last.trim();
      const full = [first, last].filter(Boolean).join(' ');
      if (!full && !f.phone.trim() && !f.email.trim() && !f.org.trim()) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcardEscape(last)};${vcardEscape(first)};;;`, `FN:${vcardEscape(full || f.org.trim())}`];
      if (f.org.trim()) lines.push(`ORG:${vcardEscape(f.org.trim())}`);
      if (f.phone.trim()) lines.push(`TEL;TYPE=CELL:${cleanPhone(f.phone)}`);
      if (f.email.trim()) lines.push(`EMAIL:${vcardEscape(f.email.trim())}`);
      if (f.url.trim()) lines.push(`URL:${vcardEscape(f.url.trim())}`);
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }
    default:
      return '';
  }
}

// WCAG relative luminance / contrast ratio for #rrggbb colours.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function colourCheck(fg, bg) {
  const lf = luminance(fg);
  const lb = luminance(bg);
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  return { ratio, inverted: lf > lb };
}
