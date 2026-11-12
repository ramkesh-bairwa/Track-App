// Mini-tool engine.
//
// Each entry here is a *real, working* client-side tool, keyed by its catalog
// slug (see lib/toolsCatalog.js — `${slugify(category)}-${slugify(name)}`).
// A tool is a plain spec: a list of input `fields` and a `run(values)` that
// computes the result with no server, no API and no third-party service — so
// every tool in this file genuinely works offline in the browser.
//
// `run` returns an object: { out, error, note, mono, swatches, preview, download }
//   out       – string shown in the output box
//   error     – red message (bad input)
//   note      – small grey hint under the output
//   mono      – render output in a monospace box
//   swatches  – [hex, …] colour chips
//   preview   – { style: {...cssProps}, label } a live preview box
//   download  – { name, text, mime } adds a Download button
// It may be async (returns a Promise) for things like hashing.
//
// To add a tool: add one entry below. It then shows "Open" in the catalog and
// opens at /dashboard/tools/catalog/<slug>.

/* ---------- shared helpers ---------- */

const num = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const fmt = (x, d = 2) =>
  Number.isFinite(x) ? (+x.toFixed(d)).toLocaleString('en-IN') : '—';
const money = (x) => '₹' + fmt(x, 2);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
      .join('')
  );
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function relLum({ r, g, b }) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function b64enc(s) {
  return btoa(String.fromCharCode.apply(null, Array.from(new TextEncoder().encode(s))));
}
function b64dec(s) {
  return new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0)));
}
// Simple reversible obfuscation (XOR with a key, then base64). NOT real crypto.
function xorCipher(text, key) {
  const k = key || 'mytrack';
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return out;
}

async function digest(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// RFC-ish CSV parse/stringify (handles quotes, commas and newlines in cells).
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}

// Minimal Markdown → HTML (headings, bold/italic/code, links, lists, paragraphs).
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  const out = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`  <li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (line.trim() === '') out.push('');
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Fancy-text (unicode math alphabet) mapping.
function mapFancy(text, up, low, dig) {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(up + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(low + (c - 97));
    else if (dig && c >= 48 && c <= 57) out += String.fromCodePoint(dig + (c - 48));
    else out += ch;
  }
  return out;
}

const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud ' +
  'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure ' +
  'reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint ' +
  'occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est').split(' ');
const WORDBANK = ('apple river tiger maple cloud stone amber ocean pixel quartz forest ember ' +
  'lunar vivid cobalt harbor meadow falcon copper willow nimbus garnet orchid velvet').split(' ');

// length/weight/data/speed unit factors (to a base unit)
const LEN = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 };
const WT = { mg: 0.001, g: 1, kg: 1000, t: 1e6, oz: 28.349523, lb: 453.59237 };
const SPD = { 'm/s': 1, 'km/h': 0.2777778, mph: 0.44704, knot: 0.514444, 'ft/s': 0.3048 };

const conv = (v, from, to, map) => (v * map[from]) / map[to];

/* ---------- hacking / CTF / security helpers (all offline) ---------- */
const _enc = (s) => new TextEncoder().encode(s);
const _dec = (b) => new TextDecoder().decode(Uint8Array.from(b));

// MD5 (crypto.subtle has no MD5, so a compact pure-JS implementation).
function md5(str) {
  const rl = (n, c) => (n << c) | (n >>> (32 - c));
  const add = (x, y) => { const l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); };
  const cmn = (q, a, b, x, s, t) => add(rl(add(add(a, q), add(x, t)), s), b);
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
  const bytes = _enc(str); const n = bytes.length;
  const nW = (((n + 8) >> 6) + 1) * 16;
  const w = new Array(nW).fill(0);
  for (let i = 0; i < n; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[n >> 2] |= 0x80 << ((n % 4) * 8);
  w[nW - 2] = n * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < nW; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a=ff(a,b,c,d,w[i],7,-680876936);d=ff(d,a,b,c,w[i+1],12,-389564586);c=ff(c,d,a,b,w[i+2],17,606105819);b=ff(b,c,d,a,w[i+3],22,-1044525330);
    a=ff(a,b,c,d,w[i+4],7,-176418897);d=ff(d,a,b,c,w[i+5],12,1200080426);c=ff(c,d,a,b,w[i+6],17,-1473231341);b=ff(b,c,d,a,w[i+7],22,-45705983);
    a=ff(a,b,c,d,w[i+8],7,1770035416);d=ff(d,a,b,c,w[i+9],12,-1958414417);c=ff(c,d,a,b,w[i+10],17,-42063);b=ff(b,c,d,a,w[i+11],22,-1990404162);
    a=ff(a,b,c,d,w[i+12],7,1804603682);d=ff(d,a,b,c,w[i+13],12,-40341101);c=ff(c,d,a,b,w[i+14],17,-1502002290);b=ff(b,c,d,a,w[i+15],22,1236535329);
    a=gg(a,b,c,d,w[i+1],5,-165796510);d=gg(d,a,b,c,w[i+6],9,-1069501632);c=gg(c,d,a,b,w[i+11],14,643717713);b=gg(b,c,d,a,w[i],20,-373897302);
    a=gg(a,b,c,d,w[i+5],5,-701558691);d=gg(d,a,b,c,w[i+10],9,38016083);c=gg(c,d,a,b,w[i+15],14,-660478335);b=gg(b,c,d,a,w[i+4],20,-405537848);
    a=gg(a,b,c,d,w[i+9],5,568446438);d=gg(d,a,b,c,w[i+14],9,-1019803690);c=gg(c,d,a,b,w[i+3],14,-187363961);b=gg(b,c,d,a,w[i+8],20,1163531501);
    a=gg(a,b,c,d,w[i+13],5,-1444681467);d=gg(d,a,b,c,w[i+2],9,-51403784);c=gg(c,d,a,b,w[i+7],14,1735328473);b=gg(b,c,d,a,w[i+12],20,-1926607734);
    a=hh(a,b,c,d,w[i+5],4,-378558);d=hh(d,a,b,c,w[i+8],11,-2022574463);c=hh(c,d,a,b,w[i+11],16,1839030562);b=hh(b,c,d,a,w[i+14],23,-35309556);
    a=hh(a,b,c,d,w[i+1],4,-1530992060);d=hh(d,a,b,c,w[i+4],11,1272893353);c=hh(c,d,a,b,w[i+7],16,-155497632);b=hh(b,c,d,a,w[i+10],23,-1094730640);
    a=hh(a,b,c,d,w[i+13],4,681279174);d=hh(d,a,b,c,w[i],11,-358537222);c=hh(c,d,a,b,w[i+3],16,-722521979);b=hh(b,c,d,a,w[i+6],23,76029189);
    a=hh(a,b,c,d,w[i+9],4,-640364487);d=hh(d,a,b,c,w[i+12],11,-421815835);c=hh(c,d,a,b,w[i+15],16,530742520);b=hh(b,c,d,a,w[i+2],23,-995338651);
    a=ii(a,b,c,d,w[i],6,-198630844);d=ii(d,a,b,c,w[i+7],10,1126891415);c=ii(c,d,a,b,w[i+14],15,-1416354905);b=ii(b,c,d,a,w[i+5],21,-57434055);
    a=ii(a,b,c,d,w[i+12],6,1700485571);d=ii(d,a,b,c,w[i+3],10,-1894986606);c=ii(c,d,a,b,w[i+10],15,-1051523);b=ii(b,c,d,a,w[i+1],21,-2054922799);
    a=ii(a,b,c,d,w[i+8],6,1873313359);d=ii(d,a,b,c,w[i+15],10,-30611744);c=ii(c,d,a,b,w[i+6],15,-1560198380);b=ii(b,c,d,a,w[i+13],21,1309151649);
    a=ii(a,b,c,d,w[i+4],6,-145523070);d=ii(d,a,b,c,w[i+11],10,-1120210379);c=ii(c,d,a,b,w[i+2],15,718787259);b=ii(b,c,d,a,w[i+9],21,-343485551);
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hx = (x) => { let s = ''; for (let i = 0; i < 4; i++) s += ((x >> (i * 8)) & 0xff).toString(16).padStart(2, '0'); return s; };
  return hx(a) + hx(b) + hx(c) + hx(d);
}

const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(str) { const b = _enc(str); let crc = 0xffffffff; for (let i = 0; i < b.length; i++) crc = CRC_TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function adler32(str) { const b = _enc(str); let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(str) { const b = _enc(str); let bits = 0, val = 0, out = ''; for (let i = 0; i < b.length; i++) { val = (val << 8) | b[i]; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; while (out.length % 8 !== 0) out += '='; return out; }
function base32Decode(s) { s = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, ''); let bits = 0, val = 0; const by = []; for (const ch of s) { const idx = B32.indexOf(ch); if (idx < 0) throw new Error('invalid Base32 character: ' + ch); val = (val << 5) | idx; bits += 5; if (bits >= 8) { by.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return _dec(by); }

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(str) { const b = _enc(str); const digits = [0]; for (let i = 0; i < b.length; i++) { let carry = b[i]; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } } let out = ''; for (let i = 0; i < b.length && b[i] === 0; i++) out += '1'; for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]]; return out; }
function base58Decode(s) { s = s.trim(); const bytes = [0]; for (const ch of s) { const v = B58.indexOf(ch); if (v < 0) throw new Error('invalid Base58 character: ' + ch); let carry = v; for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry = carry >> 8; } while (carry) { bytes.push(carry & 0xff); carry = carry >> 8; } } const lead = []; for (let i = 0; i < s.length && s[i] === '1'; i++) lead.push(0); return _dec(lead.concat(bytes.reverse())); }

// Morse code
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.' };
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
function morseEncode(t) { return t.toUpperCase().split('').map((ch) => ch === ' ' ? '/' : (MORSE[ch] ?? '')).filter((x) => x !== '').join(' '); }
function morseDecode(t) { return t.trim().split(/\s+/).map((c) => c === '/' ? ' ' : (MORSE_REV[c] ?? '')).join(''); }

// Classical ciphers
function caesarShift(t, n) { const s = ((n % 26) + 26) % 26; return t.replace(/[a-z]/gi, (ch) => { const base = ch <= 'Z' ? 65 : 97; return String.fromCharCode(((ch.charCodeAt(0) - base + s) % 26) + base); }); }
function atbash(t) { return t.replace(/[a-z]/gi, (ch) => { const base = ch <= 'Z' ? 65 : 97; return String.fromCharCode(base + (25 - (ch.charCodeAt(0) - base))); }); }
function rot47(t) { let o = ''; for (const ch of t) { const c = ch.charCodeAt(0); o += (c >= 33 && c <= 126) ? String.fromCharCode(33 + ((c - 33 + 47) % 94)) : ch; } return o; }
function vigenere(t, key, dec = false) { const k = (key || '').replace(/[^a-z]/gi, '').toUpperCase(); if (!k) throw new Error('key must contain letters'); let ki = 0, o = ''; for (const ch of t) { if (/[a-z]/i.test(ch)) { const base = ch <= 'Z' ? 65 : 97; const shift = k.charCodeAt(ki % k.length) - 65; const x = ch.charCodeAt(0) - base; const y = dec ? (x - shift + 26) % 26 : (x + shift) % 26; o += String.fromCharCode(y + base); ki++; } else o += ch; } return o; }
function railFenceEnc(t, rails) { if (rails < 2) return t; const rows = Array.from({ length: rails }, () => []); let r = 0, dir = 1; for (const ch of t) { rows[r].push(ch); if (r === 0) dir = 1; else if (r === rails - 1) dir = -1; r += dir; } return rows.map((x) => x.join('')).join(''); }
function railFenceDec(t, rails) { if (rails < 2) return t; const pattern = []; let r = 0, dir = 1; for (let i = 0; i < t.length; i++) { pattern.push(r); if (r === 0) dir = 1; else if (r === rails - 1) dir = -1; r += dir; } const idx = pattern.map((row, i) => [row, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const out = new Array(t.length); for (let i = 0; i < t.length; i++) out[idx[i][1]] = t[i]; return out.join(''); }
function egcd(a, b) { if (b === 0) return [a, 1, 0]; const [g, x, y] = egcd(b, a % b); return [g, y, x - Math.floor(a / b) * y]; }
function modInv(a, m) { const [g, x] = egcd(((a % m) + m) % m, m); if (g !== 1) return null; return ((x % m) + m) % m; }
function affineEnc(t, a, b) { return t.replace(/[a-z]/gi, (ch) => { const up = ch <= 'Z'; const x = ch.toLowerCase().charCodeAt(0) - 97; const y = ((a * x + b) % 26 + 26) % 26; return String.fromCharCode(y + (up ? 65 : 97)); }); }
function affineDec(t, a, b) { const inv = modInv(a, 26); if (inv == null) return null; return t.replace(/[a-z]/gi, (ch) => { const up = ch <= 'Z'; const y = ch.toLowerCase().charCodeAt(0) - 97; const x = (inv * ((y - b) % 26 + 26)) % 26; return String.fromCharCode(x + (up ? 65 : 97)); }); }
// Bacon (26-letter variant: A=aaaaa … Z=bbbbb)
function baconEnc(t) { return t.toUpperCase().replace(/[^A-Z]/g, '').split('').map((ch) => (ch.charCodeAt(0) - 65).toString(2).padStart(5, '0').replace(/0/g, 'A').replace(/1/g, 'B')).join(' '); }
function baconDec(t) { const groups = t.toUpperCase().replace(/[^AB]/g, '').match(/.{1,5}/g) || []; return groups.filter((g) => g.length === 5).map((g) => String.fromCharCode(65 + parseInt(g.replace(/A/g, '0').replace(/B/g, '1'), 2))).join(''); }
function a1z26Enc(t) { return t.toUpperCase().split('').map((ch) => /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 64) : (ch === ' ' ? '/' : '')).filter((x) => x !== '').join(' '); }
function a1z26Dec(t) { return t.trim().split(/\s+/).map((p) => p === '/' ? ' ' : (/^\d+$/.test(p) && +p >= 1 && +p <= 26 ? String.fromCharCode(64 + +p) : '')).join(''); }
// Polybius 5x5 (I/J share cell 24)
const POLY = 'ABCDEFGHIKLMNOPQRSTUVWXYZ';
function polybiusEnc(t) { return t.toUpperCase().replace(/J/g, 'I').replace(/[^A-Z]/g, '').split('').map((ch) => { const i = POLY.indexOf(ch); return `${(i / 5 | 0) + 1}${(i % 5) + 1}`; }).join(' '); }
function polybiusDec(t) { const nums = t.replace(/[^1-5]/g, ''); let o = ''; for (let i = 0; i + 1 < nums.length; i += 2) { const r = +nums[i] - 1, c = +nums[i + 1] - 1; o += POLY[r * 5 + c] || ''; } return o; }
const LEET = { a: '4', b: '8', e: '3', g: '9', i: '1', l: '1', o: '0', s: '5', t: '7', z: '2' };
const LEET_REV = { 4: 'a', 8: 'b', 3: 'e', 9: 'g', 1: 'i', 0: 'o', 5: 's', 7: 't', 2: 'z' };
const NATO = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'Xray', Y: 'Yankee', Z: 'Zulu', 0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' };

// Networking helpers
function ipToInt(ip) { const p = ip.trim().split('.'); if (p.length !== 4 || p.some((o) => !/^\d+$/.test(o) || +o > 255)) throw new Error('invalid IPv4 address'); return (((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]) >>> 0; }
function intToIp(n) { n = n >>> 0; return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
function ipv6Expand(ip) { ip = ip.trim(); if (!ip.includes(':')) throw new Error('not an IPv6 address'); const [head, tail] = ip.split('::'); if (tail === undefined) { const g = head.split(':'); if (g.length !== 8) throw new Error('invalid IPv6 (needs 8 groups or ::)'); return g.map((x) => x.padStart(4, '0')).join(':'); } const h = head ? head.split(':') : []; const t = tail ? tail.split(':') : []; const miss = 8 - h.length - t.length; if (miss < 0) throw new Error('invalid IPv6'); return [...h, ...Array(miss).fill('0'), ...t].map((x) => x.padStart(4, '0')).join(':'); }
function ipv6Compress(ip) { const full = ipv6Expand(ip).split(':').map((x) => parseInt(x, 16).toString(16)); let best = -1, bestLen = 0, i = 0; while (i < 8) { if (full[i] === '0') { let j = i; while (j < 8 && full[j] === '0') j++; if (j - i > bestLen) { bestLen = j - i; best = i; } i = j; } else i++; } if (bestLen < 2) return full.join(':'); return (full.slice(0, best).join(':') + '::' + full.slice(best + bestLen).join(':')).replace(/:::/, '::'); }

// Shannon entropy (bits/char) and index of coincidence
function shannon(s) { if (!s.length) return 0; const freq = {}; for (const c of s) freq[c] = (freq[c] || 0) + 1; let h = 0; for (const k in freq) { const p = freq[k] / s.length; h -= p * Math.log2(p); } return h; }
function indexOfCoincidence(s) { const t = s.toUpperCase().replace(/[^A-Z]/g, ''); const n = t.length; if (n < 2) return 0; const f = {}; for (const c of t) f[c] = (f[c] || 0) + 1; let sum = 0; for (const k in f) sum += f[k] * (f[k] - 1); return sum / (n * (n - 1)); }

// Common ports & HTTP status reference tables
const PORTS = { 20: 'FTP data', 21: 'FTP control', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP server', 68: 'DHCP client', 69: 'TFTP', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 587: 'SMTP (submission)', 636: 'LDAPS', 993: 'IMAPS', 995: 'POP3S', 1433: 'MS SQL Server', 1521: 'Oracle DB', 2049: 'NFS', 3306: 'MySQL/MariaDB', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP alt', 8443: 'HTTPS alt', 9200: 'Elasticsearch', 11211: 'Memcached', 27017: 'MongoDB' };
const HTTP_STATUS = { 100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 413: 'Payload Too Large', 418: "I'm a teapot", 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

// Base64url (JWT-style)
const b64urlEnc = (s) => b64enc(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDec = (s) => { let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return b64dec(t); };

/* ---------- field builders ---------- */
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const area = (key, label, extra = {}) => ({ key, label, type: 'textarea', rows: 6, ...extra });
const nf = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });
const sel = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
const chk = (key, label, extra = {}) => ({ key, label, type: 'checkbox', ...extra });
const date = (key, label, extra = {}) => ({ key, label, type: 'date', ...extra });

/* ================================================================
 * SPECS
 * ============================================================== */
const SPECS = {
  /* ---------------- Calculators ---------------- */
  'calculators-percentage-calculator': {
    fields: [nf('x', 'First number (X)', { default: 25 }), nf('y', 'Second number (Y)', { default: 200 })],
    run: (v) => {
      const x = num(v.x), y = num(v.y);
      return {
        out:
          `${fmt(x)}% of ${fmt(y)}  =  ${fmt((x * y) / 100)}\n` +
          `${fmt(x)} is  ${fmt(y ? (x / y) * 100 : 0)}%  of ${fmt(y)}\n` +
          `Change from ${fmt(x)} → ${fmt(y)}  =  ${fmt(x ? ((y - x) / x) * 100 : 0)}%`,
        mono: true,
      };
    },
  },
  'calculators-age-calculator': {
    fields: [date('dob', 'Date of birth'), date('at', 'Age at date (leave for today)')],
    run: (v) => {
      if (!v.dob) return { out: '' };
      const a = new Date(v.dob);
      const b = v.at ? new Date(v.at) : new Date();
      if (b < a) return { error: 'The "age at" date is before the birth date.' };
      let y = b.getFullYear() - a.getFullYear();
      let m = b.getMonth() - a.getMonth();
      let d = b.getDate() - a.getDate();
      if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
      if (m < 0) { y--; m += 12; }
      const days = Math.floor((b - a) / 86400000);
      return { out: `${y} years, ${m} months, ${d} days\n= ${fmt(days, 0)} days total\n= ${fmt(days * 24, 0)} hours`, mono: true };
    },
  },
  'calculators-date-difference-calculator': {
    fields: [date('from', 'From date'), date('to', 'To date')],
    run: (v) => {
      if (!v.from || !v.to) return { out: '' };
      const a = new Date(v.from), b = new Date(v.to);
      const days = Math.round(Math.abs(b - a) / 86400000);
      return { out: `${fmt(days, 0)} days\n${fmt(days / 7, 1)} weeks\n${fmt(days / 30.44, 1)} months\n${fmt(days / 365.25, 2)} years`, mono: true };
    },
  },
  'calculators-time-duration-calculator': {
    fields: [text('start', 'Start time (HH:MM)', { placeholder: '09:30' }), text('end', 'End time (HH:MM)', { placeholder: '17:15' })],
    run: (v) => {
      const p = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
      const a = p(v.start), b = p(v.end);
      if (a == null || b == null) return { error: 'Enter times as HH:MM, e.g. 09:30.' };
      let mins = b - a; if (mins < 0) mins += 1440;
      return { out: `${Math.floor(mins / 60)}h ${mins % 60}m  (${mins} minutes, ${fmt(mins / 60, 2)} hours)`, mono: true };
    },
  },
  'calculators-bmi-calculator': {
    fields: [nf('w', 'Weight (kg)', { default: 70 }), nf('h', 'Height (cm)', { default: 170 })],
    run: (v) => {
      const h = num(v.h) / 100;
      if (!h) return { out: '' };
      const bmi = num(v.w) / (h * h);
      const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
      return { out: `BMI = ${fmt(bmi, 1)}  →  ${cat}`, mono: true };
    },
  },
  'calculators-unit-converter': {
    fields: [
      nf('v', 'Value', { default: 1 }),
      sel('kind', 'Type', ['Length', 'Weight', 'Speed']),
      text('from', 'From unit', { placeholder: 'm / kg / km/h', default: 'm' }),
      text('to', 'To unit', { placeholder: 'ft / lb / mph', default: 'ft' }),
    ],
    run: (v) => {
      const map = v.kind === 'Weight' ? WT : v.kind === 'Speed' ? SPD : LEN;
      const f = (v.from || '').trim(), t = (v.to || '').trim();
      if (!(f in map) || !(t in map)) return { error: `Units for ${v.kind}: ${Object.keys(map).join(', ')}` };
      return { out: `${fmt(num(v.v))} ${f} = ${fmt(conv(num(v.v), f, t, map), 6)} ${t}`, mono: true };
    },
  },
  'calculators-length-converter': {
    fields: [nf('v', 'Value', { default: 1 }), sel('from', 'From', Object.keys(LEN), { default: 'm' }), sel('to', 'To', Object.keys(LEN), { default: 'ft' })],
    run: (v) => ({ out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, LEN), 6)} ${v.to}`, mono: true }),
  },
  'calculators-weight-converter': {
    fields: [nf('v', 'Value', { default: 1 }), sel('from', 'From', Object.keys(WT), { default: 'kg' }), sel('to', 'To', Object.keys(WT), { default: 'lb' })],
    run: (v) => ({ out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, WT), 6)} ${v.to}`, mono: true }),
  },
  'calculators-temperature-converter': {
    fields: [nf('v', 'Value', { default: 100 }), sel('from', 'From', ['C', 'F', 'K'], { default: 'C' }), sel('to', 'To', ['C', 'F', 'K'], { default: 'F' })],
    run: (v) => {
      const x = num(v.v);
      const c = v.from === 'C' ? x : v.from === 'F' ? (x - 32) * 5 / 9 : x - 273.15;
      const out = v.to === 'C' ? c : v.to === 'F' ? c * 9 / 5 + 32 : c + 273.15;
      return { out: `${fmt(x)} °${v.from} = ${fmt(out, 2)} °${v.to}`, mono: true };
    },
  },
  'calculators-speed-converter': {
    fields: [nf('v', 'Value', { default: 100 }), sel('from', 'From', Object.keys(SPD), { default: 'km/h' }), sel('to', 'To', Object.keys(SPD), { default: 'mph' })],
    run: (v) => ({ out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, SPD), 4)} ${v.to}`, mono: true }),
  },
  'calculators-area-calculator': {
    fields: [sel('shape', 'Shape', ['Rectangle', 'Circle', 'Triangle']), nf('a', 'Side A / radius / base', { default: 10 }), nf('b', 'Side B / height', { default: 5 })],
    run: (v) => {
      const a = num(v.a), b = num(v.b);
      const area = v.shape === 'Circle' ? Math.PI * a * a : v.shape === 'Triangle' ? 0.5 * a * b : a * b;
      return { out: `Area = ${fmt(area, 4)} square units`, mono: true };
    },
  },
  'calculators-volume-calculator': {
    fields: [sel('shape', 'Shape', ['Box', 'Cylinder', 'Sphere']), nf('a', 'A (length / radius)', { default: 10 }), nf('b', 'B (width / height)', { default: 5 }), nf('c', 'C (depth)', { default: 5 })],
    run: (v) => {
      const a = num(v.a), b = num(v.b), c = num(v.c);
      const vol = v.shape === 'Cylinder' ? Math.PI * a * a * b : v.shape === 'Sphere' ? (4 / 3) * Math.PI * a ** 3 : a * b * c;
      return { out: `Volume = ${fmt(vol, 4)} cubic units`, mono: true };
    },
  },
  'calculators-fuel-cost-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 300 }), nf('eff', 'Mileage (km per litre)', { default: 15 }), nf('price', 'Fuel price (₹/litre)', { default: 100 })],
    run: (v) => {
      const litres = num(v.eff) ? num(v.dist) / num(v.eff) : 0;
      return { out: `Fuel needed: ${fmt(litres, 2)} L\nTotal cost: ${money(litres * num(v.price))}`, mono: true };
    },
  },
  'calculators-discount-calculator': {
    fields: [nf('price', 'Original price', { default: 2000 }), nf('pct', 'Discount %', { default: 25 })],
    run: (v) => {
      const save = (num(v.price) * num(v.pct)) / 100;
      return { out: `You save ${money(save)}\nFinal price: ${money(num(v.price) - save)}`, mono: true };
    },
  },
  'calculators-tip-calculator': {
    fields: [nf('bill', 'Bill amount', { default: 1200 }), nf('pct', 'Tip %', { default: 10 }), nf('people', 'Split between', { default: 2 })],
    run: (v) => {
      const tip = (num(v.bill) * num(v.pct)) / 100;
      const total = num(v.bill) + tip;
      const per = num(v.people) ? total / num(v.people) : total;
      return { out: `Tip: ${money(tip)}\nTotal: ${money(total)}\nPer person: ${money(per)}`, mono: true };
    },
  },
  'calculators-tax-calculator': {
    fields: [nf('amt', 'Amount', { default: 5000 }), nf('rate', 'Tax rate %', { default: 18 })],
    run: (v) => {
      const tax = (num(v.amt) * num(v.rate)) / 100;
      return { out: `Tax: ${money(tax)}\nTotal: ${money(num(v.amt) + tax)}`, mono: true };
    },
  },
  'calculators-gst-calculator': {
    fields: [nf('amt', 'Amount', { default: 5000 }), nf('rate', 'GST %', { default: 18 }), sel('mode', 'Mode', ['Add GST', 'Remove GST'])],
    run: (v) => {
      const r = num(v.rate), amt = num(v.amt);
      if (v.mode === 'Remove GST') {
        const base = amt / (1 + r / 100);
        return { out: `Base: ${money(base)}\nGST: ${money(amt - base)}\nTotal (incl.): ${money(amt)}`, mono: true };
      }
      const gst = (amt * r) / 100;
      return { out: `Base: ${money(amt)}\nGST: ${money(gst)}\nTotal: ${money(amt + gst)}`, mono: true };
    },
  },
  'calculators-emi-calculator': {
    fields: [nf('p', 'Loan amount', { default: 500000 }), nf('rate', 'Annual interest %', { default: 9 }), nf('months', 'Tenure (months)', { default: 60 })],
    run: (v) => {
      const p = num(v.p), r = num(v.rate) / 1200, n = num(v.months);
      if (!n) return { out: '' };
      const emi = r ? (p * r * (1 + r) ** n) / ((1 + r) ** n - 1) : p / n;
      const total = emi * n;
      return { out: `EMI: ${money(emi)}/month\nTotal payable: ${money(total)}\nTotal interest: ${money(total - p)}`, mono: true };
    },
  },
  'calculators-compound-interest-calculator': {
    fields: [nf('p', 'Principal', { default: 100000 }), nf('rate', 'Annual rate %', { default: 8 }), nf('years', 'Years', { default: 5 }), nf('n', 'Compounds per year', { default: 4 })],
    run: (v) => {
      const p = num(v.p), r = num(v.rate) / 100, t = num(v.years), n = num(v.n) || 1;
      const amt = p * (1 + r / n) ** (n * t);
      return { out: `Maturity amount: ${money(amt)}\nInterest earned: ${money(amt - p)}`, mono: true };
    },
  },
  'calculators-break-even-calculator': {
    fields: [nf('fixed', 'Fixed costs', { default: 100000 }), nf('price', 'Price per unit', { default: 500 }), nf('varc', 'Variable cost per unit', { default: 300 })],
    run: (v) => {
      const m = num(v.price) - num(v.varc);
      if (m <= 0) return { error: 'Price per unit must exceed variable cost.' };
      const units = num(v.fixed) / m;
      return { out: `Break-even: ${fmt(units, 0)} units\n= ${money(units * num(v.price))} in sales`, mono: true };
    },
  },

  /* ---------------- Text ---------------- */
  'text-case-converter': {
    fields: [area('t', 'Text'), sel('mode', 'Convert to', ['UPPERCASE', 'lowercase', 'Title Case', 'Sentence case', 'camelCase', 'snake_case', 'kebab-case'])],
    run: (v) => {
      const t = v.t || '';
      const words = t.match(/[A-Za-z0-9]+/g) || [];
      let out = t;
      switch (v.mode) {
        case 'UPPERCASE': out = t.toUpperCase(); break;
        case 'lowercase': out = t.toLowerCase(); break;
        case 'Title Case': out = t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); break;
        case 'Sentence case': out = t.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase()); break;
        case 'camelCase': out = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''); break;
        case 'snake_case': out = words.map((w) => w.toLowerCase()).join('_'); break;
        case 'kebab-case': out = words.map((w) => w.toLowerCase()).join('-'); break;
        default: break;
      }
      return { out };
    },
  },
  'text-whitespace-cleaner': {
    fields: [area('t', 'Text'), chk('collapse', 'Collapse multiple spaces', { default: true }), chk('trim', 'Trim each line', { default: true }), chk('blank', 'Remove blank lines', { default: true })],
    run: (v) => {
      let lines = (v.t || '').split('\n');
      if (v.trim) lines = lines.map((l) => l.trim());
      if (v.collapse) lines = lines.map((l) => l.replace(/[ \t]+/g, ' '));
      if (v.blank) lines = lines.filter((l) => l.trim() !== '');
      return { out: lines.join('\n') };
    },
  },
  'text-duplicate-line-remover': {
    fields: [area('t', 'Text'), chk('ci', 'Ignore case', { default: false }), chk('trim', 'Ignore surrounding spaces', { default: true })],
    run: (v) => {
      const seen = new Set(); const out = [];
      for (const line of (v.t || '').split('\n')) {
        let k = v.trim ? line.trim() : line;
        if (v.ci) k = k.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(line); }
      }
      return { out: out.join('\n'), note: `${out.length} unique lines` };
    },
  },
  'text-line-sorter': {
    fields: [area('t', 'Text'), sel('order', 'Order', ['A → Z', 'Z → A', 'Shortest first', 'Longest first', 'Numeric', 'Shuffle'])],
    run: (v) => {
      let lines = (v.t || '').split('\n');
      switch (v.order) {
        case 'A → Z': lines.sort((a, b) => a.localeCompare(b)); break;
        case 'Z → A': lines.sort((a, b) => b.localeCompare(a)); break;
        case 'Shortest first': lines.sort((a, b) => a.length - b.length); break;
        case 'Longest first': lines.sort((a, b) => b.length - a.length); break;
        case 'Numeric': lines.sort((a, b) => parseFloat(a) - parseFloat(b)); break;
        case 'Shuffle': lines = lines.map((l) => [Math.random(), l]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); break;
        default: break;
      }
      return { out: lines.join('\n') };
    },
  },
  'text-text-reverser': {
    fields: [area('t', 'Text'), sel('mode', 'Reverse by', ['Characters', 'Words', 'Lines'])],
    run: (v) => {
      const t = v.t || '';
      const out = v.mode === 'Words' ? t.split(/(\s+)/).reverse().join('') : v.mode === 'Lines' ? t.split('\n').reverse().join('\n') : [...t].reverse().join('');
      return { out };
    },
  },
  'text-slug-generator': {
    fields: [text('t', 'Text'), sel('sep', 'Separator', ['-', '_'])],
    run: (v) => ({ out: (v.t || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, v.sep || '-').replace(/^[-_]+|[-_]+$/g, ''), mono: true }),
  },
  'text-diff-checker': {
    fields: [area('a', 'Original'), area('b', 'Changed')],
    run: (v) => {
      const A = (v.a || '').split('\n'), B = (v.b || '').split('\n');
      const n = Math.max(A.length, B.length); const out = [];
      for (let i = 0; i < n; i++) {
        if (A[i] === B[i]) out.push('  ' + (A[i] ?? ''));
        else { if (A[i] !== undefined) out.push('- ' + A[i]); if (B[i] !== undefined) out.push('+ ' + B[i]); }
      }
      return { out: out.join('\n'), mono: true, note: 'Lines prefixed  - removed  + added' };
    },
  },
  'text-word-frequency-counter': {
    fields: [area('t', 'Text'), nf('top', 'Show top N', { default: 20 })],
    run: (v) => {
      const words = (v.t || '').toLowerCase().match(/[a-z0-9']+/g) || [];
      const m = new Map();
      for (const w of words) m.set(w, (m.get(w) || 0) + 1);
      const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, num(v.top) || 20);
      return { out: rows.map(([w, c]) => `${String(c).padStart(5)}  ${w}`).join('\n'), mono: true, note: `${words.length} words, ${m.size} unique` };
    },
  },
  'text-lorem-ipsum-generator': {
    fields: [nf('paras', 'Paragraphs', { default: 3 }), nf('words', 'Words per paragraph', { default: 40 })],
    run: (v) => {
      const out = [];
      for (let p = 0; p < (num(v.paras) || 1); p++) {
        const w = [];
        for (let i = 0; i < (num(v.words) || 40); i++) w.push(LOREM[Math.floor(Math.random() * LOREM.length)]);
        let s = w.join(' '); s = s[0].toUpperCase() + s.slice(1) + '.';
        out.push(s);
      }
      return { out: out.join('\n\n') };
    },
  },
  'text-fancy-text-generator': {
    fields: [text('t', 'Text', { default: 'Hello' })],
    run: (v) => {
      const t = v.t || '';
      return {
        out:
          'Bold        ' + mapFancy(t, 0x1d400, 0x1d41a, 0x1d7ce) + '\n' +
          'Italic      ' + mapFancy(t, 0x1d434, 0x1d44e) + '\n' +
          'Bold Italic ' + mapFancy(t, 0x1d468, 0x1d482) + '\n' +
          'Script      ' + mapFancy(t, 0x1d49c, 0x1d4b6) + '\n' +
          'Monospace   ' + mapFancy(t, 0x1d670, 0x1d68a, 0x1d7f6) + '\n' +
          'Double      ' + mapFancy(t, 0x1d538, 0x1d552, 0x1d7d8),
      };
    },
  },
  'text-text-to-ascii-converter': {
    fields: [area('t', 'Text'), sel('base', 'Output', ['Decimal', 'Hex', 'Binary'])],
    run: (v) => {
      const codes = [...(v.t || '')].map((c) => c.codePointAt(0));
      const r = v.base === 'Hex' ? codes.map((c) => c.toString(16)) : v.base === 'Binary' ? codes.map((c) => c.toString(2)) : codes;
      return { out: r.join(' '), mono: true };
    },
  },
  'text-ascii-to-text-converter': {
    fields: [area('t', 'Codes (space-separated)', { placeholder: '72 101 108 108 111' }), sel('base', 'Input', ['Decimal', 'Hex', 'Binary'])],
    run: (v) => {
      const radix = v.base === 'Hex' ? 16 : v.base === 'Binary' ? 2 : 10;
      try {
        const out = (v.t || '').trim().split(/\s+/).filter(Boolean).map((n) => String.fromCodePoint(parseInt(n, radix))).join('');
        return { out };
      } catch { return { error: 'Could not parse those codes.' }; }
    },
  },
  'text-find-and-replace-tool': {
    fields: [area('t', 'Text'), text('find', 'Find'), text('rep', 'Replace with'), chk('re', 'Find is a regex'), chk('ci', 'Ignore case', { default: false })],
    run: (v) => {
      if (!v.find) return { out: v.t || '' };
      try {
        const flags = 'g' + (v.ci ? 'i' : '');
        const pat = v.re ? new RegExp(v.find, flags) : new RegExp(v.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        return { out: (v.t || '').replace(pat, v.rep || '') };
      } catch (e) { return { error: 'Invalid regex: ' + e.message }; }
    },
  },
  'text-text-splitter': {
    fields: [area('t', 'Text'), text('sep', 'Split on', { default: ',', placeholder: ', or \\n' })],
    run: (v) => {
      const sep = (v.sep || ',').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      const parts = (v.t || '').split(sep);
      return { out: parts.join('\n'), note: `${parts.length} pieces` };
    },
  },
  'text-text-joiner': {
    fields: [area('t', 'Lines'), text('sep', 'Join with', { default: ', ' })],
    run: (v) => {
      const sep = (v.sep ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      return { out: (v.t || '').split('\n').filter((l) => l !== '').join(sep) };
    },
  },
  'text-reading-time-calculator': {
    fields: [area('t', 'Text'), nf('wpm', 'Reading speed (wpm)', { default: 200 })],
    run: (v) => {
      const words = ((v.t || '').match(/\S+/g) || []).length;
      const mins = words / (num(v.wpm) || 200);
      return { out: `${words} words\n≈ ${fmt(mins, 1)} min read (${Math.ceil(mins * 60)} sec)`, mono: true };
    },
  },

  /* ---------------- Developer ---------------- */
  'developer-json-formatter': {
    fields: [area('t', 'JSON', { rows: 8 }), sel('indent', 'Indent', ['2 spaces', '4 spaces', 'Tab', 'Minify'])],
    run: (v) => {
      try {
        const obj = JSON.parse(v.t || 'null');
        const space = v.indent === 'Minify' ? 0 : v.indent === 'Tab' ? '\t' : v.indent === '4 spaces' ? 4 : 2;
        return { out: JSON.stringify(obj, null, space), mono: true };
      } catch (e) { return { error: 'Invalid JSON: ' + e.message }; }
    },
  },
  'developer-json-validator': {
    fields: [area('t', 'JSON', { rows: 8 })],
    run: (v) => {
      try { JSON.parse(v.t || ''); return { out: '✓ Valid JSON' }; }
      catch (e) { return { error: '✗ ' + e.message }; }
    },
  },
  'developer-xml-formatter': {
    fields: [area('t', 'XML / HTML', { rows: 8 })],
    run: (v) => {
      const xml = (v.t || '').replace(/>\s+</g, '><').trim();
      let out = '', depth = 0;
      xml.replace(/<[^>]+>|[^<]+/g, (tok) => {
        if (/^<\/.+>/.test(tok)) depth--;
        out += '  '.repeat(Math.max(0, depth)) + tok.trim() + '\n';
        if (/^<[^!?/][^>]*[^/]>$/.test(tok) && !/^<.*\/>$/.test(tok)) depth++;
        return tok;
      });
      return { out: out.trim(), mono: true };
    },
  },
  'developer-html-formatter': {
    fields: [area('t', 'HTML', { rows: 8 })],
    run: (v) => SPECS['developer-xml-formatter'].run(v),
  },
  'developer-css-minifier': {
    fields: [area('t', 'CSS', { rows: 8 })],
    run: (v) => ({
      out: (v.t || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,])\s*/g, '$1').replace(/;}/g, '}').replace(/\s+/g, ' ').trim(),
      mono: true,
    }),
  },
  'developer-javascript-minifier': {
    fields: [area('t', 'JavaScript', { rows: 8 })],
    run: (v) => ({
      out: (v.t || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim(),
      mono: true,
      note: 'Basic minify (comments + whitespace). Not a full compiler.',
    }),
  },
  'developer-sql-formatter': {
    fields: [area('t', 'SQL', { rows: 8 })],
    run: (v) => {
      let s = (v.t || '').replace(/\s+/g, ' ').trim();
      s = s.replace(/\b(SELECT|FROM|WHERE|AND|OR|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM)\b/gi, (m) => '\n' + m.toUpperCase());
      return { out: s.trim(), mono: true };
    },
  },
  'developer-regex-tester': {
    fields: [text('pat', 'Pattern'), text('flags', 'Flags', { default: 'g' }), area('t', 'Test string')],
    run: (v) => {
      if (!v.pat) return { out: '' };
      try {
        const re = new RegExp(v.pat, v.flags || '');
        const m = [...(v.t || '').matchAll(new RegExp(v.pat, (v.flags || '').includes('g') ? v.flags : (v.flags || '') + 'g'))];
        if (!m.length) return { out: 'No matches.' };
        return { out: m.map((x, i) => `#${i + 1}  "${x[0]}"  at ${x.index}` + (x.length > 1 ? '  groups: ' + x.slice(1).map((g) => JSON.stringify(g)).join(', ') : '')).join('\n'), mono: true, note: `${m.length} matches` };
      } catch (e) { return { error: 'Invalid regex: ' + e.message }; }
    },
  },
  'developer-base64-encoder': {
    fields: [area('t', 'Text')],
    run: (v) => { try { return { out: b64enc(v.t || ''), mono: true }; } catch (e) { return { error: e.message }; } },
  },
  'developer-base64-decoder': {
    fields: [area('t', 'Base64')],
    run: (v) => { try { return { out: b64dec(v.t || '') }; } catch { return { error: 'Not valid Base64.' }; } },
  },
  'developer-url-encoder': {
    fields: [area('t', 'Text'), chk('comp', 'Encode every reserved char', { default: true })],
    run: (v) => ({ out: v.comp ? encodeURIComponent(v.t || '') : encodeURI(v.t || ''), mono: true }),
  },
  'developer-url-decoder': {
    fields: [area('t', 'Encoded text')],
    run: (v) => { try { return { out: decodeURIComponent((v.t || '').replace(/\+/g, ' ')) }; } catch { return { error: 'Could not decode.' }; } },
  },
  'developer-jwt-decoder': {
    fields: [area('t', 'JWT', { rows: 4 })],
    run: (v) => {
      const parts = (v.t || '').trim().split('.');
      if (parts.length < 2) return { error: 'Not a JWT (expected header.payload.signature).' };
      const dec = (p) => { const s = p.replace(/-/g, '+').replace(/_/g, '/'); return b64dec(s + '='.repeat((4 - (s.length % 4)) % 4)); };
      try {
        const head = JSON.stringify(JSON.parse(dec(parts[0])), null, 2);
        const body = JSON.stringify(JSON.parse(dec(parts[1])), null, 2);
        return { out: `HEADER\n${head}\n\nPAYLOAD\n${body}`, mono: true, note: 'Signature is not verified.' };
      } catch (e) { return { error: 'Could not decode: ' + e.message }; }
    },
  },
  'developer-uuid-generator': {
    fields: [nf('n', 'How many', { default: 5 })],
    run: (v) => ({ out: Array.from({ length: Math.min(500, num(v.n) || 1) }, () => crypto.randomUUID()).join('\n'), mono: true }),
  },
  'developer-hash-generator': {
    fields: [area('t', 'Text'), sel('algo', 'Algorithm', ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512'])],
    run: async (v) => ({ out: await digest(v.algo || 'SHA-256', v.t || ''), mono: true }),
  },
  'developer-cron-builder': {
    fields: [text('min', 'Minute', { default: '0' }), text('hr', 'Hour', { default: '9' }), text('dom', 'Day of month', { default: '*' }), text('mon', 'Month', { default: '*' }), text('dow', 'Day of week', { default: '*' })],
    run: (v) => {
      const expr = `${v.min || '*'} ${v.hr || '*'} ${v.dom || '*'} ${v.mon || '*'} ${v.dow || '*'}`;
      return { out: expr, mono: true, note: 'minute hour day-of-month month day-of-week' };
    },
  },
  'developer-color-code-converter': {
    fields: [text('c', 'Colour (hex)', { default: '#3b82f6' })],
    run: (v) => {
      const rgb = hexToRgb(v.c);
      if (!rgb) return { error: 'Enter a hex colour like #3b82f6.' };
      const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return { out: `HEX  ${rgbToHex(rgb.r, rgb.g, rgb.b)}\nRGB  rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\nHSL  hsl(${h}, ${s}%, ${l}%)`, mono: true, swatches: [rgbToHex(rgb.r, rgb.g, rgb.b)] };
    },
  },
  'developer-timestamp-converter': {
    fields: [text('t', 'Unix timestamp or date', { placeholder: '1700000000 or 2026-11-02' })],
    run: (v) => {
      const s = (v.t || '').trim();
      if (!s) return { out: `Now: ${Math.floor(Date.now() / 1000)} (unix)\n${new Date().toISOString()}` };
      let d;
      if (/^\d{10}$/.test(s)) d = new Date(+s * 1000);
      else if (/^\d{13}$/.test(s)) d = new Date(+s);
      else d = new Date(s);
      if (isNaN(d)) return { error: 'Could not parse that.' };
      return { out: `Unix (s): ${Math.floor(d.getTime() / 1000)}\nUnix (ms): ${d.getTime()}\nISO: ${d.toISOString()}\nLocal: ${d.toString()}`, mono: true };
    },
  },
  'developer-diff-checker': {
    fields: [area('a', 'Original'), area('b', 'Changed')],
    run: (v) => SPECS['text-diff-checker'].run(v),
  },

  /* ---------------- Security & Privacy ---------------- */
  'security-and-privacy-password-generator': {
    fields: [nf('len', 'Length', { default: 16 }), chk('upper', 'A-Z', { default: true }), chk('lower', 'a-z', { default: true }), chk('digit', '0-9', { default: true }), chk('sym', 'Symbols', { default: true })],
    run: (v) => {
      let pool = '';
      if (v.upper) pool += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      if (v.lower) pool += 'abcdefghijkmnopqrstuvwxyz';
      if (v.digit) pool += '23456789';
      if (v.sym) pool += '!@#$%^&*()-_=+?';
      if (!pool) return { error: 'Pick at least one character set.' };
      const len = Math.max(4, Math.min(128, num(v.len) || 16));
      const arr = new Uint32Array(len); crypto.getRandomValues(arr);
      return { out: Array.from(arr, (x) => pool[x % pool.length]).join(''), mono: true };
    },
  },
  'security-and-privacy-password-strength-checker': {
    fields: [text('p', 'Password')],
    run: (v) => {
      const p = v.p || '';
      let score = 0;
      if (p.length >= 8) score++; if (p.length >= 12) score++; if (p.length >= 16) score++;
      if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
      if (/\d/.test(p)) score++; if (/[^A-Za-z0-9]/.test(p)) score++;
      const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong', 'Excellent'][Math.min(score, 6)];
      return { out: `Strength: ${label}  (${score}/6)\nLength: ${p.length}`, mono: true };
    },
  },
  'security-and-privacy-passphrase-generator': {
    fields: [nf('words', 'Words', { default: 4 }), text('sep', 'Separator', { default: '-' })],
    run: (v) => {
      const n = Math.max(2, Math.min(12, num(v.words) || 4));
      const arr = new Uint32Array(n); crypto.getRandomValues(arr);
      return { out: Array.from(arr, (x) => WORDBANK[x % WORDBANK.length]).join(v.sep || '-'), mono: true };
    },
  },
  'security-and-privacy-hash-calculator': {
    fields: [area('t', 'Text'), sel('algo', 'Algorithm', ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512'])],
    run: async (v) => ({ out: await digest(v.algo || 'SHA-256', v.t || ''), mono: true }),
  },
  'security-and-privacy-random-token-generator': {
    fields: [nf('len', 'Length (bytes)', { default: 32 }), sel('fmt', 'Format', ['Hex', 'Base64', 'Alphanumeric'])],
    run: (v) => {
      const n = Math.max(1, Math.min(256, num(v.len) || 32));
      const bytes = new Uint8Array(n); crypto.getRandomValues(bytes);
      let out;
      if (v.fmt === 'Base64') out = btoa(String.fromCharCode.apply(null, Array.from(bytes)));
      else if (v.fmt === 'Alphanumeric') { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; out = Array.from(bytes, (b) => a[b % a.length]).join(''); }
      else out = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return { out, mono: true };
    },
  },
  'security-and-privacy-secure-note-generator': {
    fields: [area('t', 'Note'), text('key', 'Passphrase', { default: 'mytrack' }), sel('mode', 'Mode', ['Encrypt', 'Decrypt'])],
    run: (v) => {
      try {
        if (v.mode === 'Decrypt') return { out: xorCipher(b64dec(v.t || ''), v.key) };
        return { out: b64enc(xorCipher(v.t || '', v.key)), mono: true, note: 'Obfuscation for casual privacy — not strong encryption.' };
      } catch { return { error: 'Could not process (check the passphrase / input).' }; }
    },
  },
  'security-and-privacy-text-masking-tool': {
    fields: [text('t', 'Text (e.g. card / email)'), nf('keepStart', 'Keep first', { default: 0 }), nf('keepEnd', 'Keep last', { default: 4 }), text('mask', 'Mask char', { default: '•' })],
    run: (v) => {
      const t = v.t || ''; const s = Math.max(0, num(v.keepStart)), e = Math.max(0, num(v.keepEnd));
      if (t.length <= s + e) return { out: t };
      return { out: t.slice(0, s) + (v.mask || '•').repeat(t.length - s - e) + t.slice(t.length - e), mono: true };
    },
  },
  'security-and-privacy-privacy-policy-generator': {
    fields: [text('co', 'Company / site name', { default: 'Acme' }), text('site', 'Website URL', { default: 'https://example.com' }), text('email', 'Contact email', { default: 'privacy@example.com' })],
    run: (v) => ({
      out:
`PRIVACY POLICY — ${v.co}

Last updated: ${new Date().toISOString().slice(0, 10)}

${v.co} ("we") operates ${v.site}. This policy explains what data we collect and how we use it.

1. Information we collect
   - Information you give us (e.g. name, email) when you contact us or sign up.
   - Technical data collected automatically (IP address, browser, pages visited) via cookies and logs.

2. How we use it
   We use your data to provide and improve our service, respond to enquiries, and keep the service secure. We do not sell your personal data.

3. Cookies
   We use cookies for essential functionality and analytics. You can disable cookies in your browser.

4. Sharing
   We share data only with service providers who help us operate, or where required by law.

5. Your rights
   You may request access to, correction of, or deletion of your personal data by emailing ${v.email}.

6. Contact
   Questions? Email ${v.email}.`,
      note: 'A starting template — have it reviewed for your jurisdiction (GDPR/CCPA/DPDP).',
    }),
  },

  /* ---------------- Design ---------------- */
  'design-color-palette-generator': {
    fields: [text('base', 'Base colour (hex)', { default: '#3b82f6' }), sel('scheme', 'Scheme', ['Complementary', 'Analogous', 'Triadic', 'Monochrome'])],
    run: (v) => {
      const rgb = hexToRgb(v.base);
      if (!rgb) return { error: 'Enter a hex colour like #3b82f6.' };
      const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const mk = (hh, ss, ll) => { const o = hslToRgb((hh + 360) % 360, Math.max(0, Math.min(100, ss)), Math.max(0, Math.min(100, ll))); return rgbToHex(o.r, o.g, o.b); };
      let cols;
      if (v.scheme === 'Complementary') cols = [mk(h, s, l), mk(h + 180, s, l)];
      else if (v.scheme === 'Analogous') cols = [mk(h - 30, s, l), mk(h, s, l), mk(h + 30, s, l)];
      else if (v.scheme === 'Triadic') cols = [mk(h, s, l), mk(h + 120, s, l), mk(h + 240, s, l)];
      else cols = [mk(h, s, l + 24), mk(h, s, l + 12), mk(h, s, l), mk(h, s, l - 12), mk(h, s, l - 24)];
      return { out: cols.join('  '), mono: true, swatches: cols };
    },
  },
  'design-gradient-generator': {
    fields: [text('c1', 'Colour 1', { default: '#3b82f6' }), text('c2', 'Colour 2', { default: '#ec4899' }), nf('angle', 'Angle (deg)', { default: 135 })],
    run: (v) => {
      const css = `linear-gradient(${num(v.angle)}deg, ${v.c1} 0%, ${v.c2} 100%)`;
      return { out: `background: ${css};`, mono: true, preview: { style: { background: css, height: '90px' }, label: 'Preview' } };
    },
  },
  'design-contrast-checker': {
    fields: [text('fg', 'Text colour', { default: '#ffffff' }), text('bg', 'Background', { default: '#3b82f6' })],
    run: (v) => {
      const a = hexToRgb(v.fg), b = hexToRgb(v.bg);
      if (!a || !b) return { error: 'Enter both colours as hex.' };
      const L1 = relLum(a), L2 = relLum(b);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const pass = (r, t) => (r >= t ? '✓ pass' : '✗ fail');
      return {
        out: `Contrast ratio: ${fmt(ratio, 2)}:1\nAA  normal text (4.5): ${pass(ratio, 4.5)}\nAA  large text (3.0): ${pass(ratio, 3)}\nAAA normal text (7.0): ${pass(ratio, 7)}`,
        mono: true,
        preview: { style: { background: v.bg, color: v.fg, padding: '14px', fontWeight: 600 }, label: 'Sample text' },
      };
    },
  },
  'design-css-shadow-generator': {
    fields: [nf('x', 'X offset', { default: 0 }), nf('y', 'Y offset', { default: 8 }), nf('blur', 'Blur', { default: 24 }), nf('spread', 'Spread', { default: -4 }), text('color', 'Colour', { default: 'rgba(0,0,0,0.25)' })],
    run: (v) => {
      const css = `${num(v.x)}px ${num(v.y)}px ${num(v.blur)}px ${num(v.spread)}px ${v.color}`;
      return { out: `box-shadow: ${css};`, mono: true, preview: { style: { boxShadow: css, height: '90px', background: '#fff', borderRadius: '10px' }, label: 'Preview' } };
    },
  },
  'design-border-radius-generator': {
    fields: [nf('tl', 'Top-left', { default: 12 }), nf('tr', 'Top-right', { default: 12 }), nf('br', 'Bottom-right', { default: 12 }), nf('bl', 'Bottom-left', { default: 12 })],
    run: (v) => {
      const css = `${num(v.tl)}px ${num(v.tr)}px ${num(v.br)}px ${num(v.bl)}px`;
      return { out: `border-radius: ${css};`, mono: true, preview: { style: { borderRadius: css, height: '90px', background: 'linear-gradient(135deg,#3b82f6,#ec4899)' }, label: 'Preview' } };
    },
  },
  'design-typography-scale-calculator': {
    fields: [nf('base', 'Base size (px)', { default: 16 }), sel('ratio', 'Scale', ['1.2 Minor third', '1.25 Major third', '1.333 Perfect fourth', '1.5 Perfect fifth', '1.618 Golden'])],
    run: (v) => {
      const r = parseFloat(v.ratio) || 1.25; const base = num(v.base) || 16;
      const steps = [-2, -1, 0, 1, 2, 3, 4, 5];
      return { out: steps.map((s) => `step ${s >= 0 ? '+' : ''}${s}  ${fmt(base * r ** s, 1)}px  (${fmt((base * r ** s) / 16, 3)}rem)`).join('\n'), mono: true };
    },
  },
  'design-design-size-converter': {
    fields: [nf('px', 'Pixels', { default: 16 }), nf('dpi', 'DPI', { default: 96 })],
    run: (v) => {
      const px = num(v.px), dpi = num(v.dpi) || 96;
      return { out: `${px}px\n= ${fmt(px / 16, 3)} rem\n= ${fmt((px / dpi) * 72, 2)} pt\n= ${fmt((px / dpi) * 25.4, 3)} mm\n= ${fmt(px / dpi, 4)} in`, mono: true };
    },
  },
  'design-print-bleed-calculator': {
    fields: [nf('w', 'Width (mm)', { default: 210 }), nf('h', 'Height (mm)', { default: 297 }), nf('bleed', 'Bleed (mm)', { default: 3 })],
    run: (v) => {
      const b = num(v.bleed) * 2;
      return { out: `Trim size: ${fmt(num(v.w), 1)} × ${fmt(num(v.h), 1)} mm\nWith bleed: ${fmt(num(v.w) + b, 1)} × ${fmt(num(v.h) + b, 1)} mm\nSafe margin: keep text ${fmt(num(v.bleed) + 2, 0)} mm inside the trim.`, mono: true };
    },
  },

  /* ---------------- Finance ---------------- */
  'finance-loan-repayment-calculator': {
    fields: [nf('p', 'Loan amount', { default: 1000000 }), nf('rate', 'Annual interest %', { default: 8.5 }), nf('years', 'Tenure (years)', { default: 20 })],
    run: (v) => {
      const p = num(v.p), r = num(v.rate) / 1200, n = num(v.years) * 12;
      if (!n) return { out: '' };
      const emi = r ? (p * r * (1 + r) ** n) / ((1 + r) ** n - 1) : p / n;
      return { out: `Monthly payment: ${money(emi)}\nTotal paid: ${money(emi * n)}\nTotal interest: ${money(emi * n - p)}`, mono: true };
    },
  },
  'finance-sip-calculator': {
    fields: [nf('m', 'Monthly investment', { default: 10000 }), nf('rate', 'Expected return % p.a.', { default: 12 }), nf('years', 'Years', { default: 10 })],
    run: (v) => {
      const m = num(v.m), i = num(v.rate) / 1200, n = num(v.years) * 12;
      const fv = i ? m * (((1 + i) ** n - 1) / i) * (1 + i) : m * n;
      return { out: `Invested: ${money(m * n)}\nFuture value: ${money(fv)}\nGain: ${money(fv - m * n)}`, mono: true };
    },
  },
  'finance-savings-goal-calculator': {
    fields: [nf('goal', 'Goal amount', { default: 500000 }), nf('have', 'Already saved', { default: 50000 }), nf('m', 'Monthly saving', { default: 10000 }), nf('rate', 'Return % p.a.', { default: 6 })],
    run: (v) => {
      let bal = num(v.have); const m = num(v.m), i = num(v.rate) / 1200, goal = num(v.goal);
      if (bal >= goal) return { out: 'Goal already reached 🎉' };
      if (m <= 0 && i <= 0) return { error: 'Add a monthly saving amount.' };
      let months = 0;
      while (bal < goal && months < 1200) { bal = bal * (1 + i) + m; months++; }
      return { out: `Reached in ${months} months (${fmt(months / 12, 1)} years)`, mono: true };
    },
  },
  'finance-profit-margin-calculator': {
    fields: [nf('cost', 'Cost', { default: 700 }), nf('price', 'Selling price', { default: 1000 })],
    run: (v) => {
      const profit = num(v.price) - num(v.cost);
      const margin = num(v.price) ? (profit / num(v.price)) * 100 : 0;
      const markup = num(v.cost) ? (profit / num(v.cost)) * 100 : 0;
      return { out: `Profit: ${money(profit)}\nMargin: ${fmt(margin, 2)}%\nMarkup: ${fmt(markup, 2)}%`, mono: true };
    },
  },
  'finance-markup-calculator': {
    fields: [nf('cost', 'Cost', { default: 700 }), nf('markup', 'Markup %', { default: 40 })],
    run: (v) => {
      const price = num(v.cost) * (1 + num(v.markup) / 100);
      return { out: `Selling price: ${money(price)}\nProfit: ${money(price - num(v.cost))}`, mono: true };
    },
  },
  'finance-sales-tax-calculator': {
    fields: [nf('amt', 'Amount', { default: 2000 }), nf('rate', 'Tax rate %', { default: 18 })],
    run: (v) => {
      const tax = (num(v.amt) * num(v.rate)) / 100;
      return { out: `Tax: ${money(tax)}\nTotal: ${money(num(v.amt) + tax)}`, mono: true };
    },
  },
  'finance-salary-calculator': {
    fields: [nf('annual', 'Annual salary', { default: 1200000 }), nf('hours', 'Hours per week', { default: 40 })],
    run: (v) => {
      const a = num(v.annual), hpw = num(v.hours) || 40;
      return { out: `Monthly: ${money(a / 12)}\nWeekly: ${money(a / 52)}\nDaily (5-day): ${money(a / 260)}\nHourly: ${money(a / (hpw * 52))}`, mono: true };
    },
  },
  'finance-overtime-calculator': {
    fields: [nf('rate', 'Hourly rate', { default: 300 }), nf('hours', 'Normal hours', { default: 160 }), nf('ot', 'Overtime hours', { default: 10 }), nf('mult', 'OT multiplier', { default: 1.5 })],
    run: (v) => {
      const base = num(v.rate) * num(v.hours);
      const otPay = num(v.rate) * num(v.mult) * num(v.ot);
      return { out: `Base pay: ${money(base)}\nOvertime: ${money(otPay)}\nTotal: ${money(base + otPay)}`, mono: true };
    },
  },
  'finance-depreciation-calculator': {
    fields: [nf('cost', 'Asset cost', { default: 100000 }), nf('salvage', 'Salvage value', { default: 10000 }), nf('life', 'Useful life (years)', { default: 5 })],
    run: (v) => {
      const annual = num(v.life) ? (num(v.cost) - num(v.salvage)) / num(v.life) : 0;
      return { out: `Straight-line depreciation\nPer year: ${money(annual)}\nPer month: ${money(annual / 12)}`, mono: true };
    },
  },
  'finance-late-fee-calculator': {
    fields: [nf('amt', 'Invoice amount', { default: 50000 }), nf('rate', 'Late fee % per period', { default: 1.5 }), nf('days', 'Days late', { default: 30 }), nf('period', 'Period (days)', { default: 30 })],
    run: (v) => {
      const periods = num(v.period) ? num(v.days) / num(v.period) : 0;
      const fee = (num(v.amt) * num(v.rate) / 100) * periods;
      return { out: `Late fee: ${money(fee)}\nTotal due: ${money(num(v.amt) + fee)}`, mono: true };
    },
  },
  'finance-freelance-rate-calculator': {
    fields: [nf('target', 'Target yearly income', { default: 1500000 }), nf('bill', 'Billable hours/week', { default: 25 }), nf('weeks', 'Working weeks/year', { default: 46 })],
    run: (v) => {
      const hours = num(v.bill) * num(v.weeks);
      return { out: hours ? `Charge ≈ ${money(num(v.target) / hours)}/hour\n(${fmt(hours, 0)} billable hours/year)` : 'Add billable hours.', mono: true };
    },
  },

  /* ---------------- Documents ---------------- */
  'documents-word-counter': {
    fields: [area('t', 'Text', { rows: 8 })],
    run: (v) => {
      const t = v.t || '';
      const words = (t.match(/\S+/g) || []).length;
      const sentences = (t.match(/[.!?]+/g) || []).length;
      const paras = t.split(/\n{2,}/).filter((p) => p.trim()).length;
      return { out: `Words: ${words}\nCharacters: ${t.length}\nCharacters (no spaces): ${t.replace(/\s/g, '').length}\nSentences: ${sentences}\nParagraphs: ${paras}\nReading time: ${fmt(words / 200, 1)} min`, mono: true };
    },
  },
  'documents-character-counter': {
    fields: [area('t', 'Text', { rows: 8 })],
    run: (v) => {
      const t = v.t || '';
      return { out: `Characters: ${t.length}\nNo spaces: ${t.replace(/\s/g, '').length}\nLetters: ${(t.match(/[a-z]/gi) || []).length}\nDigits: ${(t.match(/\d/g) || []).length}\nLines: ${t.split('\n').length}`, mono: true };
    },
  },

  /* ---------------- Marketing ---------------- */
  'marketing-utm-builder': {
    fields: [text('url', 'Website URL', { default: 'https://example.com' }), text('source', 'utm_source', { default: 'newsletter' }), text('medium', 'utm_medium', { default: 'email' }), text('campaign', 'utm_campaign', { default: 'launch' }), text('term', 'utm_term'), text('content', 'utm_content')],
    run: (v) => {
      try {
        const u = new URL(v.url);
        const add = (k, val) => { if (val) u.searchParams.set(k, val); };
        add('utm_source', v.source); add('utm_medium', v.medium); add('utm_campaign', v.campaign); add('utm_term', v.term); add('utm_content', v.content);
        return { out: u.toString(), mono: true };
      } catch { return { error: 'Enter a valid URL (with https://).' }; }
    },
  },
  'marketing-campaign-url-builder': {
    fields: [text('url', 'Website URL', { default: 'https://example.com' }), text('source', 'utm_source', { default: 'newsletter' }), text('medium', 'utm_medium', { default: 'email' }), text('campaign', 'utm_campaign', { default: 'launch' }), text('term', 'utm_term'), text('content', 'utm_content')],
    run: (v) => SPECS['marketing-utm-builder'].run(v),
  },
  'marketing-hashtag-generator': {
    fields: [text('t', 'Keywords (comma or space separated)', { default: 'coffee morning routine' }), chk('camel', 'CamelCase multi-word', { default: true })],
    run: (v) => {
      const parts = (v.t || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const tags = parts.map((p) => {
        const words = p.split(/\s+/);
        const body = v.camel ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join('') : words.join('').toLowerCase();
        return '#' + body.replace(/[^A-Za-z0-9]/g, '');
      });
      return { out: tags.join(' '), note: `${tags.length} hashtags` };
    },
  },

  /* ---------------- Education ---------------- */
  'education-grade-calculator': {
    fields: [area('t', 'Scores, one per line as got/total', { default: '18/20\n42/50\n8/10', rows: 6 })],
    run: (v) => {
      let got = 0, tot = 0; const rows = [];
      for (const line of (v.t || '').split('\n')) {
        const m = /^(.*?)([\d.]+)\s*\/\s*([\d.]+)/.exec(line.trim());
        if (!m) continue;
        const g = parseFloat(m[2]), t = parseFloat(m[3]);
        got += g; tot += t;
        rows.push(`${fmt((g / t) * 100, 1)}%  (${g}/${t})`);
      }
      if (!tot) return { out: '' };
      const pct = (got / tot) * 100;
      const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
      return { out: rows.join('\n') + `\n\nOverall: ${fmt(pct, 2)}%  →  ${grade}`, mono: true };
    },
  },
  'education-gpa-calculator': {
    fields: [area('t', 'One per line: grade,credits (e.g. A,4)', { default: 'A,4\nB,3\nA,3\nC,2', rows: 6 })],
    run: (v) => {
      const pts = { 'A+': 10, A: 9, 'B+': 8, B: 7, 'C+': 6, C: 5, D: 4, F: 0 };
      let qp = 0, cr = 0;
      for (const line of (v.t || '').split('\n')) {
        const [g, c] = line.split(',').map((s) => (s || '').trim());
        const p = pts[(g || '').toUpperCase()];
        const credits = parseFloat(c);
        if (p === undefined || !Number.isFinite(credits)) continue;
        qp += p * credits; cr += credits;
      }
      if (!cr) return { out: '', note: 'Use grades A+, A, B+, B, C+, C, D, F.' };
      return { out: `GPA: ${fmt(qp / cr, 2)} / 10\nTotal credits: ${cr}`, mono: true };
    },
  },

  /* ---------------- Health & Fitness ---------------- */
  'health-and-fitness-running-pace-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 5 }), nf('min', 'Time (minutes)', { default: 30 })],
    run: (v) => {
      const d = num(v.dist), m = num(v.min);
      if (!d) return { out: '' };
      const pace = m / d;
      return { out: `Pace: ${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')} min/km\nSpeed: ${fmt(d / (m / 60), 2)} km/h`, mono: true };
    },
  },
  'health-and-fitness-calorie-estimate-calculator': {
    fields: [nf('w', 'Weight (kg)', { default: 70 }), nf('min', 'Duration (minutes)', { default: 30 }), sel('act', 'Activity', ['Walking (3.5)', 'Running (9.8)', 'Cycling (7.5)', 'Swimming (8)', 'Yoga (2.5)', 'Gym (6)'])],
    run: (v) => {
      const met = parseFloat((v.act.match(/\(([\d.]+)\)/) || [])[1]) || 3.5;
      const cal = (met * 3.5 * num(v.w) / 200) * num(v.min);
      return { out: `≈ ${fmt(cal, 0)} kcal burned`, mono: true };
    },
  },
  'health-and-fitness-bmi-calculator': {
    fields: [nf('w', 'Weight (kg)', { default: 70 }), nf('h', 'Height (cm)', { default: 170 })],
    run: (v) => SPECS['calculators-bmi-calculator'].run(v),
  },
  'health-and-fitness-heart-rate-zone-calculator': {
    fields: [nf('age', 'Age', { default: 30 }), nf('rest', 'Resting HR (optional)', { default: 0 })],
    run: (v) => {
      const max = 220 - num(v.age);
      const z = (lo, hi) => `${Math.round(max * lo)}–${Math.round(max * hi)} bpm`;
      return { out: `Max HR: ${max} bpm\nWarm-up (50-60%): ${z(0.5, 0.6)}\nFat burn (60-70%): ${z(0.6, 0.7)}\nAerobic (70-80%): ${z(0.7, 0.8)}\nAnaerobic (80-90%): ${z(0.8, 0.9)}\nMax (90-100%): ${z(0.9, 1)}`, mono: true };
    },
  },
  'health-and-fitness-step-distance-calculator': {
    fields: [nf('steps', 'Steps', { default: 8000 }), nf('stride', 'Stride length (cm)', { default: 75 })],
    run: (v) => {
      const km = (num(v.steps) * num(v.stride)) / 100000;
      return { out: `Distance: ${fmt(km, 2)} km (${fmt(km * 1000, 0)} m)`, mono: true };
    },
  },
  'health-and-fitness-macro-calculator': {
    fields: [nf('cal', 'Daily calories', { default: 2000 }), sel('plan', 'Split', ['Balanced 40/30/30', 'Low-carb 20/40/40', 'High-protein 30/40/30'])],
    run: (v) => {
      const [c, p, f] = (v.plan.match(/(\d+)\/(\d+)\/(\d+)/) || []).slice(1).map(Number);
      const cal = num(v.cal);
      return { out: `Carbs: ${fmt((cal * c / 100) / 4, 0)} g\nProtein: ${fmt((cal * p / 100) / 4, 0)} g\nFat: ${fmt((cal * f / 100) / 9, 0)} g`, mono: true };
    },
  },
  'health-and-fitness-one-rep-max-calculator': {
    fields: [nf('w', 'Weight lifted', { default: 80 }), nf('reps', 'Reps', { default: 5 })],
    run: (v) => {
      const orm = num(v.w) * (1 + num(v.reps) / 30);
      return { out: `Estimated 1RM: ${fmt(orm, 1)}\n90%: ${fmt(orm * 0.9, 1)}  ·  80%: ${fmt(orm * 0.8, 1)}  ·  70%: ${fmt(orm * 0.7, 1)}`, mono: true, note: 'Epley formula.' };
    },
  },
  'health-and-fitness-walking-speed-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 3 }), nf('min', 'Time (minutes)', { default: 36 })],
    run: (v) => ({ out: num(v.min) ? `Speed: ${fmt(num(v.dist) / (num(v.min) / 60), 2)} km/h` : '', mono: true }),
  },
  'health-and-fitness-cycling-pace-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 20 }), nf('min', 'Time (minutes)', { default: 45 })],
    run: (v) => {
      if (!num(v.dist)) return { out: '' };
      const pace = num(v.min) / num(v.dist);
      return { out: `Speed: ${fmt(num(v.dist) / (num(v.min) / 60), 2)} km/h\nPace: ${fmt(pace, 2)} min/km`, mono: true };
    },
  },

  /* ---------------- Food & Cooking ---------------- */
  'food-and-cooking-recipe-scaler': {
    fields: [nf('from', 'Original servings', { default: 4 }), nf('to', 'Desired servings', { default: 6 }), area('t', 'Ingredients (one per line, start with amount)', { default: '200 g flour\n2 eggs\n100 ml milk', rows: 6 })],
    run: (v) => {
      const factor = num(v.from) ? num(v.to) / num(v.from) : 1;
      const out = (v.t || '').split('\n').map((l) => l.replace(/^\s*([\d.]+)/, (m) => fmt(parseFloat(m) * factor, 2))).join('\n');
      return { out, note: `Scaled ×${fmt(factor, 2)}` };
    },
  },
  'food-and-cooking-ingredient-unit-converter': {
    fields: [nf('v', 'Amount', { default: 1 }), sel('from', 'From', ['cup', 'tbsp', 'tsp', 'ml', 'fl oz', 'l'], { default: 'cup' }), sel('to', 'To', ['cup', 'tbsp', 'tsp', 'ml', 'fl oz', 'l'], { default: 'ml' })],
    run: (v) => {
      const VOL = { cup: 240, tbsp: 15, tsp: 5, ml: 1, 'fl oz': 29.5735, l: 1000 };
      return { out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, VOL), 3)} ${v.to}`, mono: true };
    },
  },
  'food-and-cooking-oven-temperature-converter': {
    fields: [nf('v', 'Temperature', { default: 180 }), sel('from', 'From', ['C', 'F'], { default: 'C' })],
    run: (v) => {
      const c = v.from === 'C' ? num(v.v) : (num(v.v) - 32) * 5 / 9;
      const gas = [[135, '1'], [150, '2'], [165, '3'], [180, '4'], [190, '5'], [200, '6'], [220, '7'], [230, '8'], [245, '9']];
      const mark = gas.reduce((a, g) => (Math.abs(g[0] - c) < Math.abs(a[0] - c) ? g : a))[1];
      return { out: `${fmt(c, 0)} °C = ${fmt(c * 9 / 5 + 32, 0)} °F ≈ Gas Mark ${mark}`, mono: true };
    },
  },
  'food-and-cooking-recipe-cost-calculator': {
    fields: [area('t', 'Ingredient costs (one number per line)', { default: '40\n25\n15', rows: 5 }), nf('serv', 'Servings', { default: 4 })],
    run: (v) => {
      const total = (v.t || '').split('\n').reduce((s, l) => s + (parseFloat(l) || 0), 0);
      return { out: `Total cost: ${money(total)}\nPer serving: ${money(num(v.serv) ? total / num(v.serv) : total)}`, mono: true };
    },
  },
  'food-and-cooking-food-cost-percentage-calculator': {
    fields: [nf('cost', 'Food cost', { default: 120 }), nf('price', 'Menu price', { default: 400 })],
    run: (v) => ({ out: num(v.price) ? `Food cost: ${fmt((num(v.cost) / num(v.price)) * 100, 1)}%\nGross profit: ${money(num(v.price) - num(v.cost))}` : '', mono: true }),
  },
  'food-and-cooking-portion-calculator': {
    fields: [nf('total', 'Total amount (g)', { default: 1000 }), nf('people', 'People', { default: 4 })],
    run: (v) => ({ out: num(v.people) ? `Per person: ${fmt(num(v.total) / num(v.people), 0)} g` : '', mono: true }),
  },
  'food-and-cooking-baker-s-percentage-calculator': {
    fields: [nf('flour', 'Flour weight (g)', { default: 500 }), area('t', 'Other ingredients: name,grams', { default: 'water,325\nsalt,10\nyeast,7', rows: 5 })],
    run: (v) => {
      const flour = num(v.flour); if (!flour) return { out: '' };
      const rows = (v.t || '').split('\n').map((l) => { const [n, g] = l.split(','); return n && g ? `${n.trim()}: ${fmt((parseFloat(g) / flour) * 100, 1)}%` : null; }).filter(Boolean);
      return { out: `flour: 100%\n${rows.join('\n')}`, mono: true };
    },
  },
  'food-and-cooking-coffee-ratio-calculator': {
    fields: [nf('water', 'Water (ml)', { default: 500 }), nf('ratio', 'Ratio 1:', { default: 16 })],
    run: (v) => ({ out: num(v.ratio) ? `Coffee: ${fmt(num(v.water) / num(v.ratio), 1)} g\nWater: ${fmt(num(v.water), 0)} ml  (1:${num(v.ratio)})` : '', mono: true }),
  },
  'food-and-cooking-kitchen-measurement-converter': {
    fields: [nf('v', 'Amount', { default: 1 }), sel('from', 'From', ['cup', 'tbsp', 'tsp', 'ml', 'l'], { default: 'cup' }), sel('to', 'To', ['cup', 'tbsp', 'tsp', 'ml', 'l'], { default: 'tbsp' })],
    run: (v) => SPECS['food-and-cooking-ingredient-unit-converter'].run(v),
  },

  /* ---------------- Real Estate ---------------- */
  'real-estate-mortgage-calculator': {
    fields: [nf('p', 'Loan amount', { default: 3000000 }), nf('rate', 'Interest % p.a.', { default: 8.5 }), nf('years', 'Years', { default: 20 })],
    run: (v) => {
      const p = num(v.p), r = num(v.rate) / 1200, n = num(v.years) * 12;
      if (!n) return { out: '' };
      const emi = r ? (p * r * (1 + r) ** n) / ((1 + r) ** n - 1) : p / n;
      return { out: `Monthly: ${money(emi)}\nTotal paid: ${money(emi * n)}\nTotal interest: ${money(emi * n - p)}`, mono: true };
    },
  },
  'real-estate-rent-vs-buy-calculator': {
    fields: [nf('rent', 'Monthly rent', { default: 20000 }), nf('price', 'Home price', { default: 5000000 }), nf('down', 'Down payment %', { default: 20 }), nf('rate', 'Loan rate % p.a.', { default: 8.5 }), nf('years', 'Years', { default: 20 })],
    run: (v) => {
      const loan = num(v.price) * (1 - num(v.down) / 100), r = num(v.rate) / 1200, n = num(v.years) * 12;
      const emi = r ? (loan * r * (1 + r) ** n) / ((1 + r) ** n - 1) : loan / n;
      return { out: `Buying EMI: ${money(emi)}/month\nRenting: ${money(num(v.rent))}/month\nDifference: ${money(emi - num(v.rent))}/month`, mono: true, note: 'Simplified — ignores appreciation, tax and maintenance.' };
    },
  },
  'real-estate-rental-yield-calculator': {
    fields: [nf('rent', 'Monthly rent', { default: 20000 }), nf('price', 'Property price', { default: 5000000 })],
    run: (v) => ({ out: num(v.price) ? `Annual rent: ${money(num(v.rent) * 12)}\nGross yield: ${fmt((num(v.rent) * 12 / num(v.price)) * 100, 2)}%` : '', mono: true }),
  },
  'real-estate-property-roi-calculator': {
    fields: [nf('income', 'Annual net income', { default: 240000 }), nf('invest', 'Total investment', { default: 5000000 })],
    run: (v) => ({ out: num(v.invest) ? `ROI: ${fmt((num(v.income) / num(v.invest)) * 100, 2)}% per year` : '', mono: true }),
  },
  'real-estate-home-affordability-calculator': {
    fields: [nf('income', 'Monthly income', { default: 100000 }), nf('debts', 'Monthly debts', { default: 10000 }), nf('rate', 'Loan rate % p.a.', { default: 8.5 }), nf('years', 'Years', { default: 20 }), nf('dti', 'Max DTI %', { default: 40 })],
    run: (v) => {
      const emi = num(v.income) * num(v.dti) / 100 - num(v.debts);
      if (emi <= 0) return { error: 'Debts exceed the affordable payment.' };
      const r = num(v.rate) / 1200, n = num(v.years) * 12;
      const loan = r ? emi * ((1 + r) ** n - 1) / (r * (1 + r) ** n) : emi * n;
      return { out: `Affordable EMI: ${money(emi)}/month\nMax loan: ${money(loan)}`, mono: true };
    },
  },
  'real-estate-down-payment-calculator': {
    fields: [nf('price', 'Property price', { default: 5000000 }), nf('pct', 'Down payment %', { default: 20 })],
    run: (v) => {
      const down = num(v.price) * num(v.pct) / 100;
      return { out: `Down payment: ${money(down)}\nLoan amount: ${money(num(v.price) - down)}`, mono: true };
    },
  },
  'real-estate-floor-plan-area-calculator': {
    fields: [area('t', 'Rooms as L x W (metres), one per line', { default: '4 x 3\n5 x 4\n3 x 2.5', rows: 5 })],
    run: (v) => {
      let total = 0; const rows = [];
      for (const l of (v.t || '').split('\n')) {
        const m = /([\d.]+)\s*[x×]\s*([\d.]+)/.exec(l);
        if (m) { const a = parseFloat(m[1]) * parseFloat(m[2]); total += a; rows.push(`${l.trim()} = ${fmt(a, 2)} m²`); }
      }
      return { out: rows.join('\n') + `\n\nTotal: ${fmt(total, 2)} m²  (${fmt(total * 10.7639, 1)} ft²)`, mono: true };
    },
  },

  /* ---------------- Automotive ---------------- */
  'automotive-fuel-economy-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 450 }), nf('fuel', 'Fuel used (litres)', { default: 30 })],
    run: (v) => num(v.fuel) ? { out: `${fmt(num(v.dist) / num(v.fuel), 2)} km/L\n${fmt((num(v.fuel) / num(v.dist)) * 100, 2)} L/100km`, mono: true } : { out: '' },
  },
  'automotive-trip-fuel-cost-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 300 }), nf('eff', 'Mileage (km/L)', { default: 15 }), nf('price', 'Fuel price (₹/L)', { default: 100 })],
    run: (v) => SPECS['calculators-fuel-cost-calculator'].run(v),
  },
  'automotive-ev-charging-cost-calculator': {
    fields: [nf('kwh', 'Battery capacity (kWh)', { default: 40 }), nf('pct', 'Charge needed %', { default: 80 }), nf('price', 'Price per kWh (₹)', { default: 9 })],
    run: (v) => {
      const units = num(v.kwh) * num(v.pct) / 100;
      return { out: `Energy: ${fmt(units, 1)} kWh\nCost: ${money(units * num(v.price))}`, mono: true };
    },
  },
  'automotive-vehicle-depreciation-calculator': {
    fields: [nf('price', 'Purchase price', { default: 1000000 }), nf('rate', 'Depreciation % per year', { default: 15 }), nf('years', 'Years', { default: 5 })],
    run: (v) => {
      const val = num(v.price) * (1 - num(v.rate) / 100) ** num(v.years);
      return { out: `Value after ${num(v.years)} yrs: ${money(val)}\nTotal loss: ${money(num(v.price) - val)}`, mono: true };
    },
  },
  'automotive-loan-emi-calculator': {
    fields: [nf('p', 'Loan amount', { default: 800000 }), nf('rate', 'Interest % p.a.', { default: 10 }), nf('months', 'Tenure (months)', { default: 60 })],
    run: (v) => SPECS['calculators-emi-calculator'].run(v),
  },
  'automotive-horsepower-converter': {
    fields: [nf('v', 'Value', { default: 100 }), sel('from', 'From', ['hp', 'kW', 'PS'], { default: 'hp' }), sel('to', 'To', ['hp', 'kW', 'PS'], { default: 'kW' })],
    run: (v) => {
      const W = { hp: 745.7, kW: 1000, PS: 735.5 };
      return { out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, W), 2)} ${v.to}`, mono: true };
    },
  },
  'automotive-car-running-cost-calculator': {
    fields: [nf('km', 'Annual km', { default: 15000 }), nf('eff', 'Mileage (km/L)', { default: 15 }), nf('price', 'Fuel price (₹/L)', { default: 100 }), nf('ins', 'Insurance/year', { default: 15000 }), nf('serv', 'Service/year', { default: 10000 })],
    run: (v) => {
      const fuel = num(v.eff) ? (num(v.km) / num(v.eff)) * num(v.price) : 0;
      const total = fuel + num(v.ins) + num(v.serv);
      return { out: `Fuel: ${money(fuel)}\nTotal/year: ${money(total)}\nPer km: ${money(num(v.km) ? total / num(v.km) : 0)}`, mono: true };
    },
  },

  /* ---------------- Travel ---------------- */
  'travel-trip-budget-calculator': {
    fields: [area('t', 'Costs (one number per line)', { default: '8000\n5000\n3000\n2000', rows: 5 }), nf('days', 'Days', { default: 4 }), nf('people', 'People', { default: 2 })],
    run: (v) => {
      const total = (v.t || '').split('\n').reduce((s, l) => s + (parseFloat(l) || 0), 0);
      return { out: `Total: ${money(total)}\nPer day: ${money(num(v.days) ? total / num(v.days) : total)}\nPer person: ${money(num(v.people) ? total / num(v.people) : total)}`, mono: true };
    },
  },
  'travel-fuel-cost-calculator': {
    fields: [nf('dist', 'Distance (km)', { default: 500 }), nf('eff', 'Mileage (km/L)', { default: 15 }), nf('price', 'Fuel price (₹/L)', { default: 100 })],
    run: (v) => SPECS['calculators-fuel-cost-calculator'].run(v),
  },
  'travel-flight-duration-calculator': {
    fields: [text('dep', 'Departure (HH:MM)', { default: '09:00' }), text('arr', 'Arrival (HH:MM)', { default: '14:30' }), nf('tz', 'Destination timezone offset (hours)', { default: 0 })],
    run: (v) => {
      const p = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
      const a = p(v.dep), b = p(v.arr);
      if (a == null || b == null) return { error: 'Enter times as HH:MM.' };
      let mins = b - a - num(v.tz) * 60; while (mins < 0) mins += 1440;
      return { out: `Flight time: ${Math.floor(mins / 60)}h ${mins % 60}m`, mono: true };
    },
  },
  'travel-hotel-split-cost-calculator': {
    fields: [nf('rate', 'Price per night', { default: 4000 }), nf('nights', 'Nights', { default: 3 }), nf('people', 'People', { default: 2 })],
    run: (v) => {
      const total = num(v.rate) * num(v.nights);
      return { out: `Total: ${money(total)}\nPer person: ${money(num(v.people) ? total / num(v.people) : total)}`, mono: true };
    },
  },
  'travel-trip-expense-splitter': {
    fields: [area('t', 'Who paid: name,amount', { default: 'Amit,4000\nBina,2500\nChetan,1000', rows: 5 })],
    run: (v) => {
      const rows = (v.t || '').split('\n').map((l) => { const [n, a] = l.split(','); return n && a ? { n: n.trim(), a: parseFloat(a) || 0 } : null; }).filter(Boolean);
      if (!rows.length) return { out: '' };
      const total = rows.reduce((s, r) => s + r.a, 0), share = total / rows.length;
      return { out: `Total: ${money(total)}\nEqual share: ${money(share)}\n\n` + rows.map((r) => `${r.n}: paid ${money(r.a)} → ${r.a >= share ? 'gets back ' + money(r.a - share) : 'owes ' + money(share - r.a)}`).join('\n'), mono: true };
    },
  },
  'travel-luggage-weight-converter': {
    fields: [nf('v', 'Weight', { default: 23 }), sel('from', 'From', ['kg', 'lb'], { default: 'kg' }), sel('to', 'To', ['kg', 'lb'], { default: 'lb' })],
    run: (v) => ({ out: `${fmt(num(v.v))} ${v.from} = ${fmt(conv(num(v.v), v.from, v.to, WT), 2)} ${v.to}`, mono: true }),
  },

  /* ---------------- Home & Lifestyle ---------------- */
  'home-and-lifestyle-room-area-calculator': {
    fields: [nf('l', 'Length (m)', { default: 4 }), nf('w', 'Width (m)', { default: 3 })],
    run: (v) => { const a = num(v.l) * num(v.w); return { out: `Area: ${fmt(a, 2)} m²  (${fmt(a * 10.7639, 1)} ft²)`, mono: true }; },
  },
  'home-and-lifestyle-paint-quantity-calculator': {
    fields: [nf('area', 'Wall area (m²)', { default: 60 }), nf('coats', 'Coats', { default: 2 }), nf('cover', 'Coverage (m²/L)', { default: 10 })],
    run: (v) => ({ out: num(v.cover) ? `Paint needed: ${fmt((num(v.area) * num(v.coats)) / num(v.cover), 2)} litres` : '', mono: true }),
  },
  'home-and-lifestyle-wallpaper-calculator': {
    fields: [nf('w', 'Wall width (m)', { default: 5 }), nf('h', 'Wall height (m)', { default: 2.7 }), nf('rw', 'Roll width (m)', { default: 0.53 }), nf('rl', 'Roll length (m)', { default: 10 })],
    run: (v) => {
      const strips = Math.ceil(num(v.w) / num(v.rw));
      const perRoll = Math.floor(num(v.rl) / num(v.h)) || 1;
      return { out: `Strips needed: ${strips}\nRolls needed: ${Math.ceil(strips / perRoll)}`, mono: true };
    },
  },
  'home-and-lifestyle-tile-calculator': {
    fields: [nf('area', 'Floor area (m²)', { default: 20 }), nf('tw', 'Tile width (cm)', { default: 30 }), nf('th', 'Tile height (cm)', { default: 30 }), nf('waste', 'Waste %', { default: 10 })],
    run: (v) => {
      const tile = (num(v.tw) / 100) * (num(v.th) / 100);
      if (!tile) return { out: '' };
      const n = Math.ceil((num(v.area) / tile) * (1 + num(v.waste) / 100));
      return { out: `Tiles needed: ${n} (incl. ${num(v.waste)}% waste)`, mono: true };
    },
  },
  'home-and-lifestyle-electricity-cost-calculator': {
    fields: [nf('w', 'Power (watts)', { default: 1000 }), nf('hrs', 'Hours per day', { default: 5 }), nf('price', 'Price per kWh (₹)', { default: 8 }), nf('days', 'Days', { default: 30 })],
    run: (v) => {
      const kwh = (num(v.w) / 1000) * num(v.hrs) * num(v.days);
      return { out: `Energy: ${fmt(kwh, 2)} kWh\nCost: ${money(kwh * num(v.price))}`, mono: true };
    },
  },
  'home-and-lifestyle-appliance-energy-calculator': {
    fields: [nf('w', 'Power (watts)', { default: 150 }), nf('hrs', 'Hours per day', { default: 8 }), nf('price', 'Price per kWh (₹)', { default: 8 })],
    run: (v) => {
      const kwhMonth = (num(v.w) / 1000) * num(v.hrs) * 30;
      return { out: `Per month: ${fmt(kwhMonth, 1)} kWh = ${money(kwhMonth * num(v.price))}\nPer year: ${money(kwhMonth * 12 * num(v.price))}`, mono: true };
    },
  },
  'home-and-lifestyle-rent-split-calculator': {
    fields: [nf('rent', 'Total rent', { default: 30000 }), nf('people', 'People', { default: 3 })],
    run: (v) => ({ out: num(v.people) ? `Per person: ${money(num(v.rent) / num(v.people))}` : '', mono: true }),
  },
  'home-and-lifestyle-storage-volume-calculator': {
    fields: [nf('l', 'Length (m)', { default: 2 }), nf('w', 'Width (m)', { default: 1.5 }), nf('h', 'Height (m)', { default: 2 })],
    run: (v) => { const vol = num(v.l) * num(v.w) * num(v.h); return { out: `Volume: ${fmt(vol, 2)} m³  (${fmt(vol * 35.3147, 1)} ft³)`, mono: true }; },
  },

  /* ---------------- Data & Analytics ---------------- */
  'data-and-analytics-percentage-change-calculator': {
    fields: [nf('old', 'Old value', { default: 200 }), nf('new', 'New value', { default: 260 })],
    run: (v) => ({ out: num(v.old) ? `Change: ${fmt(((num(v.new) - num(v.old)) / num(v.old)) * 100, 2)}%\nDifference: ${fmt(num(v.new) - num(v.old), 2)}` : '', mono: true }),
  },
  'data-and-analytics-column-statistics-tool': {
    fields: [area('t', 'Numbers (one per line or comma-separated)', { default: '12\n18\n7\n25\n14', rows: 6 })],
    run: (v) => {
      const nums = (v.t || '').split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x));
      if (!nums.length) return { out: '' };
      const sum = nums.reduce((a, b) => a + b, 0), mean = sum / nums.length;
      const sorted = [...nums].sort((a, b) => a - b);
      const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      const sd = Math.sqrt(nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length);
      return { out: `Count: ${nums.length}\nSum: ${fmt(sum)}\nMean: ${fmt(mean)}\nMedian: ${fmt(med)}\nMin: ${fmt(sorted[0])}\nMax: ${fmt(sorted[sorted.length - 1])}\nStd dev: ${fmt(sd)}`, mono: true };
    },
  },
  'data-and-analytics-correlation-calculator': {
    fields: [area('t', 'Pairs: x,y per line', { default: '1,2\n2,4\n3,5\n4,4\n5,6', rows: 6 })],
    run: (v) => {
      const pts = (v.t || '').split('\n').map((l) => l.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      const n = pts.length; if (n < 2) return { out: '' };
      const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
      const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0), sx2 = pts.reduce((s, p) => s + p[0] ** 2, 0), sy2 = pts.reduce((s, p) => s + p[1] ** 2, 0);
      const r = (n * sxy - sx * sy) / Math.sqrt((n * sx2 - sx ** 2) * (n * sy2 - sy ** 2));
      return { out: `Pearson r = ${fmt(r, 4)}\n${Math.abs(r) > 0.7 ? 'Strong' : Math.abs(r) > 0.4 ? 'Moderate' : 'Weak'} ${r >= 0 ? 'positive' : 'negative'} correlation`, mono: true };
    },
  },

  /* ---------------- Social Media ---------------- */
  'social-media-engagement-rate-calculator': {
    fields: [nf('eng', 'Likes + comments + shares', { default: 450 }), nf('followers', 'Followers', { default: 10000 })],
    run: (v) => ({ out: num(v.followers) ? `Engagement rate: ${fmt((num(v.eng) / num(v.followers)) * 100, 2)}%` : '', mono: true }),
  },
  'social-media-cross-platform-text-formatter': {
    fields: [area('t', 'Post text', { rows: 5 })],
    run: (v) => {
      const len = (v.t || '').length;
      const lim = { Twitter: 280, 'Instagram caption': 2200, 'LinkedIn': 3000, 'Facebook': 63206, 'Bluesky': 300 };
      return { out: Object.entries(lim).map(([k, n]) => `${k}: ${len}/${n} ${len <= n ? '✓' : '✗ over by ' + (len - n)}`).join('\n'), mono: true };
    },
  },

  /* ---------------- Marketing ---------------- */
  'marketing-a-b-test-calculator': {
    fields: [nf('va', 'A visitors', { default: 1000 }), nf('ca', 'A conversions', { default: 90 }), nf('vb', 'B visitors', { default: 1000 }), nf('cb', 'B conversions', { default: 115 })],
    run: (v) => {
      const ra = num(v.va) ? num(v.ca) / num(v.va) : 0, rb = num(v.vb) ? num(v.cb) / num(v.vb) : 0;
      return { out: `A: ${fmt(ra * 100, 2)}%\nB: ${fmt(rb * 100, 2)}%\nLift: ${fmt(ra ? ((rb - ra) / ra) * 100 : 0, 2)}%`, mono: true, note: 'Significance test not included.' };
    },
  },
  'marketing-campaign-roi-calculator': {
    fields: [nf('rev', 'Revenue', { default: 500000 }), nf('cost', 'Campaign cost', { default: 100000 })],
    run: (v) => ({ out: num(v.cost) ? `Profit: ${money(num(v.rev) - num(v.cost))}\nROI: ${fmt(((num(v.rev) - num(v.cost)) / num(v.cost)) * 100, 1)}%` : '', mono: true }),
  },
  'marketing-coupon-code-generator': {
    fields: [text('prefix', 'Prefix', { default: 'SALE' }), nf('count', 'How many', { default: 10 }), nf('len', 'Random chars', { default: 6 })],
    run: (v) => {
      const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const n = Math.min(200, num(v.count) || 1), len = Math.min(16, num(v.len) || 6);
      const out = [];
      for (let i = 0; i < n; i++) {
        const r = new Uint32Array(len); crypto.getRandomValues(r);
        out.push((v.prefix || '') + Array.from(r, (x) => a[x % a.length]).join(''));
      }
      return { out: out.join('\n'), mono: true };
    },
  },

  /* ---------------- SEO ---------------- */
  'seo-keyword-density-checker': {
    fields: [area('t', 'Content', { rows: 6 }), text('kw', 'Keyword', { default: 'seo' })],
    run: (v) => {
      const words = (v.t || '').toLowerCase().match(/[a-z0-9']+/g) || [];
      const kw = (v.kw || '').toLowerCase().trim();
      if (!kw) return { out: '' };
      const count = words.filter((w) => w === kw).length;
      return { out: `Total words: ${words.length}\n"${kw}" appears: ${count} times\nDensity: ${fmt(words.length ? (count / words.length) * 100 : 0, 2)}%`, mono: true };
    },
  },
  'seo-serp-snippet-previewer': {
    fields: [text('title', 'Title', { default: 'Best Running Shoes 2026 — Buyer Guide' }), area('desc', 'Meta description', { rows: 3, default: 'Compare the top running shoes of 2026 with expert reviews, prices and fit tips.' }), text('url', 'URL', { default: 'example.com/running-shoes' })],
    run: (v) => {
      const t = (v.title || '').length, d = (v.desc || '').length;
      return { out: `Title: ${t} chars ${t <= 60 ? '✓' : '✗ trim to ~60'}\nDescription: ${d} chars ${d >= 120 && d <= 160 ? '✓' : '✗ aim 120–160'}\n\n${v.url}\n${v.title}\n${v.desc}`, mono: true };
    },
  },
  'seo-title-tag-checker': {
    fields: [text('t', 'Title tag')],
    run: (v) => { const n = (v.t || '').length; return { out: `${n} characters (~${Math.round(n * 9)}px)\n${n === 0 ? 'Empty' : n <= 60 ? '✓ Good length' : '✗ Too long — trim to ≤60'}`, mono: true }; },
  },
  'seo-meta-description-checker': {
    fields: [area('t', 'Meta description', { rows: 3 })],
    run: (v) => { const n = (v.t || '').length; return { out: `${n} characters\n${n === 0 ? 'Empty' : n < 120 ? '✗ Too short — aim 120–160' : n <= 160 ? '✓ Good length' : '✗ Too long — trim to ≤160'}`, mono: true }; },
  },
  'seo-readability-analyzer': {
    fields: [area('t', 'Text', { rows: 6 })],
    run: (v) => {
      const t = v.t || '';
      const words = t.match(/\S+/g) || [];
      const sentences = (t.match(/[.!?]+/g) || []).length || 1;
      const syll = words.reduce((s, w) => s + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
      if (!words.length) return { out: '' };
      const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syll / words.length);
      const grade = score >= 90 ? 'Very easy' : score >= 70 ? 'Easy' : score >= 60 ? 'Standard' : score >= 50 ? 'Fairly hard' : score >= 30 ? 'Difficult' : 'Very difficult';
      return { out: `Flesch reading ease: ${fmt(score, 1)}  →  ${grade}\nWords: ${words.length}, Sentences: ${sentences}, Avg words/sentence: ${fmt(words.length / sentences, 1)}`, mono: true };
    },
  },

  /* ---------------- Networking ---------------- */
  'networking-subnet-calculator': {
    fields: [text('ip', 'IP address', { default: '192.168.1.10' }), nf('cidr', 'CIDR prefix', { default: 24 })],
    run: (v) => {
      const parts = (v.ip || '').split('.').map(Number);
      if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return { error: 'Enter a valid IPv4 address.' };
      const cidr = Math.max(0, Math.min(32, num(v.cidr)));
      const ipN = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
      const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
      const net = (ipN & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
      const toIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      const hosts = cidr >= 31 ? 0 : (bc - net - 1);
      return { out: `Network: ${toIp(net)}/${cidr}\nNetmask: ${toIp(mask)}\nBroadcast: ${toIp(bc)}\nUsable range: ${toIp(net + 1)} – ${toIp(bc - 1)}\nUsable hosts: ${hosts}`, mono: true };
    },
  },
  'networking-cidr-calculator': {
    fields: [nf('cidr', 'CIDR prefix', { default: 24 })],
    run: (v) => {
      const cidr = Math.max(0, Math.min(32, num(v.cidr)));
      const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
      const toIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      const total = 2 ** (32 - cidr);
      return { out: `Netmask: ${toIp(mask)}\nTotal addresses: ${fmt(total, 0)}\nUsable hosts: ${fmt(Math.max(0, total - 2), 0)}`, mono: true };
    },
  },
  'networking-bandwidth-calculator': {
    fields: [nf('size', 'File size', { default: 500 }), sel('sunit', 'Size unit', ['MB', 'GB', 'TB'], { default: 'MB' }), nf('speed', 'Speed', { default: 50 }), sel('spunit', 'Speed unit', ['Mbps', 'MB/s', 'Gbps'], { default: 'Mbps' })],
    run: (v) => {
      const bytes = num(v.size) * { MB: 1e6, GB: 1e9, TB: 1e12 }[v.sunit];
      const bps = num(v.speed) * { Mbps: 125000, 'MB/s': 1e6, Gbps: 125000000 }[v.spunit];
      if (!bps) return { out: '' };
      const sec = bytes / bps;
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
      return { out: `Transfer time: ${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s  (${fmt(sec, 1)} seconds)`, mono: true };
    },
  },
  'networking-transfer-time-calculator': {
    fields: [nf('size', 'File size', { default: 500 }), sel('sunit', 'Size unit', ['MB', 'GB', 'TB'], { default: 'MB' }), nf('speed', 'Speed', { default: 50 }), sel('spunit', 'Speed unit', ['Mbps', 'MB/s', 'Gbps'], { default: 'Mbps' })],
    run: (v) => SPECS['networking-bandwidth-calculator'].run(v),
  },

  /* ---------------- Database ---------------- */
  'database-sql-formatter': {
    fields: [area('t', 'SQL', { rows: 8 })],
    run: (v) => SPECS['developer-sql-formatter'].run(v),
  },
  'database-connection-string-builder': {
    fields: [sel('driver', 'Database', ['MySQL', 'PostgreSQL', 'MongoDB', 'SQL Server']), text('host', 'Host', { default: 'localhost' }), text('port', 'Port', { default: '3306' }), text('db', 'Database', { default: 'mydb' }), text('user', 'User', { default: 'admin' }), text('pass', 'Password', { default: 'secret' })],
    run: (v) => {
      let s;
      if (v.driver === 'PostgreSQL') s = `postgresql://${v.user}:${v.pass}@${v.host}:${v.port || 5432}/${v.db}`;
      else if (v.driver === 'MongoDB') s = `mongodb://${v.user}:${v.pass}@${v.host}:${v.port || 27017}/${v.db}`;
      else if (v.driver === 'SQL Server') s = `Server=${v.host},${v.port || 1433};Database=${v.db};User Id=${v.user};Password=${v.pass};`;
      else s = `mysql://${v.user}:${v.pass}@${v.host}:${v.port || 3306}/${v.db}`;
      return { out: s, mono: true };
    },
  },
  'database-csv-to-sql-insert-generator': {
    fields: [text('table', 'Table name', { default: 'users' }), area('t', 'CSV (first row = columns)', { default: 'id,name,email\n1,Amit,amit@x.com\n2,Bina,bina@x.com', rows: 7 })],
    run: (v) => {
      const lines = (v.t || '').trim().split('\n');
      if (lines.length < 2) return { out: '' };
      const cols = lines[0].split(',').map((c) => c.trim());
      const rows = lines.slice(1).map((l) => {
        const vals = l.split(',').map((x) => { const t = x.trim(); return /^-?\d+(\.\d+)?$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`; });
        return `INSERT INTO ${v.table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
      });
      return { out: rows.join('\n'), mono: true };
    },
  },

  /* ---------------- Cloud & DevOps ---------------- */
  'cloud-and-devops-cron-builder': {
    fields: [text('min', 'Minute', { default: '0' }), text('hr', 'Hour', { default: '*/6' }), text('dom', 'Day of month', { default: '*' }), text('mon', 'Month', { default: '*' }), text('dow', 'Day of week', { default: '*' })],
    run: (v) => SPECS['developer-cron-builder'].run(v),
  },
  'cloud-and-devops-semantic-version-calculator': {
    fields: [text('v', 'Current version', { default: '1.4.2' }), sel('bump', 'Bump', ['major', 'minor', 'patch'])],
    run: (v) => {
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v.v || '').trim());
      if (!m) return { error: 'Enter a version like 1.4.2' };
      let [maj, min, pat] = m.slice(1).map(Number);
      if (v.bump === 'major') { maj++; min = 0; pat = 0; }
      else if (v.bump === 'minor') { min++; pat = 0; }
      else pat++;
      return { out: `${maj}.${min}.${pat}`, mono: true };
    },
  },
  'cloud-and-devops-uptime-calculator': {
    fields: [nf('pct', 'Uptime %', { default: 99.9 })],
    run: (v) => {
      const down = (1 - num(v.pct) / 100);
      const fmtT = (sec) => sec >= 86400 ? fmt(sec / 86400, 2) + ' days' : sec >= 3600 ? fmt(sec / 3600, 2) + ' hours' : fmt(sec / 60, 1) + ' min';
      return { out: `Allowed downtime:\nPer day: ${fmtT(down * 86400)}\nPer month: ${fmtT(down * 2592000)}\nPer year: ${fmtT(down * 31536000)}`, mono: true };
    },
  },
  'cloud-and-devops-log-timestamp-converter': {
    fields: [text('t', 'Unix timestamp or date')],
    run: (v) => SPECS['developer-timestamp-converter'].run(v),
  },

  /* ---------------- Events & Invitations ---------------- */
  'events-and-invitations-event-countdown': {
    fields: [date('d', 'Event date')],
    run: (v) => {
      if (!v.d) return { out: '' };
      const days = Math.ceil((new Date(v.d) - new Date()) / 86400000);
      return { out: days > 0 ? `${days} days to go` : days === 0 ? 'Today! 🎉' : `${-days} days ago`, mono: true };
    },
  },
  'events-and-invitations-event-budget-calculator': {
    fields: [area('t', 'Costs (one number per line)', { default: '50000\n30000\n15000\n10000', rows: 5 }), nf('guests', 'Guests', { default: 100 })],
    run: (v) => {
      const total = (v.t || '').split('\n').reduce((s, l) => s + (parseFloat(l) || 0), 0);
      return { out: `Total: ${money(total)}\nPer guest: ${money(num(v.guests) ? total / num(v.guests) : total)}`, mono: true };
    },
  },
  'events-and-invitations-party-food-calculator': {
    fields: [nf('guests', 'Guests', { default: 30 }), nf('hours', 'Event length (hours)', { default: 3 })],
    run: (v) => {
      const g = num(v.guests);
      return { out: `Appetizers: ${g * (num(v.hours) >= 3 ? 6 : 4)} pieces\nMain servings: ${g} (+10% = ${Math.ceil(g * 1.1)})\nDrinks: ${g * num(v.hours)} servings\nDessert: ${Math.ceil(g * 1.2)} portions`, mono: true, note: 'Rough catering estimates.' };
    },
  },

  /* ---------------- Shopping & Comparison ---------------- */
  'shopping-and-comparison-unit-price-calculator': {
    fields: [nf('price', 'Price', { default: 250 }), nf('qty', 'Quantity', { default: 5 }), text('unit', 'Unit', { default: 'kg' })],
    run: (v) => ({ out: num(v.qty) ? `${money(num(v.price) / num(v.qty))} per ${v.unit}` : '', mono: true }),
  },
  'shopping-and-comparison-bulk-buy-calculator': {
    fields: [nf('pa', 'Option A price', { default: 100 }), nf('qa', 'Option A quantity', { default: 2 }), nf('pb', 'Option B price', { default: 230 }), nf('qb', 'Option B quantity', { default: 5 })],
    run: (v) => {
      const a = num(v.qa) ? num(v.pa) / num(v.qa) : Infinity, b = num(v.qb) ? num(v.pb) / num(v.qb) : Infinity;
      return { out: `A: ${money(a)}/unit\nB: ${money(b)}/unit\n→ ${a < b ? 'Option A is cheaper' : b < a ? 'Option B is cheaper' : 'Same price'}`, mono: true };
    },
  },
  'shopping-and-comparison-price-per-weight-calculator': {
    fields: [nf('price', 'Price', { default: 180 }), nf('weight', 'Weight', { default: 500 }), sel('unit', 'Weight unit', ['g', 'kg'], { default: 'g' })],
    run: (v) => {
      const grams = v.unit === 'kg' ? num(v.weight) * 1000 : num(v.weight);
      if (!grams) return { out: '' };
      return { out: `${money((num(v.price) / grams) * 1000)} per kg\n${money((num(v.price) / grams) * 100)} per 100 g`, mono: true };
    },
  },
  'shopping-and-comparison-discount-comparison-calculator': {
    fields: [nf('price', 'Original price', { default: 2000 }), nf('d1', 'Discount 1 %', { default: 25 }), nf('d2', 'Discount 2 %', { default: 30 })],
    run: (v) => {
      const p1 = num(v.price) * (1 - num(v.d1) / 100), p2 = num(v.price) * (1 - num(v.d2) / 100);
      return { out: `${num(v.d1)}% off → ${money(p1)}\n${num(v.d2)}% off → ${money(p2)}\n→ Save ${money(Math.abs(p1 - p2))} more with ${p1 < p2 ? num(v.d1) : num(v.d2)}%`, mono: true };
    },
  },
  'shopping-and-comparison-installment-cost-calculator': {
    fields: [nf('price', 'Price', { default: 60000 }), nf('down', 'Down payment', { default: 10000 }), nf('months', 'Months', { default: 12 }), nf('rate', 'Interest % p.a.', { default: 14 })],
    run: (v) => {
      const p = num(v.price) - num(v.down), r = num(v.rate) / 1200, n = num(v.months);
      if (!n) return { out: '' };
      const emi = r ? (p * r * (1 + r) ** n) / ((1 + r) ** n - 1) : p / n;
      return { out: `Monthly: ${money(emi)}\nTotal cost: ${money(num(v.down) + emi * n)}\nExtra vs cash: ${money(emi * n - p)}`, mono: true };
    },
  },

  /* ---------------- Project Management ---------------- */
  'project-management-sprint-capacity-calculator': {
    fields: [nf('people', 'Team members', { default: 5 }), nf('days', 'Sprint days', { default: 10 }), nf('hrs', 'Hours/day', { default: 6 }), nf('focus', 'Focus %', { default: 80 })],
    run: (v) => {
      const cap = num(v.people) * num(v.days) * num(v.hrs) * (num(v.focus) / 100);
      return { out: `Capacity: ${fmt(cap, 0)} hours`, mono: true };
    },
  },
  'project-management-story-point-calculator': {
    fields: [nf('points', 'Backlog points', { default: 120 }), nf('velocity', 'Velocity (points/sprint)', { default: 25 })],
    run: (v) => ({ out: num(v.velocity) ? `Sprints needed: ${fmt(num(v.points) / num(v.velocity), 1)}` : '', mono: true }),
  },
  'project-management-project-budget-calculator': {
    fields: [area('t', 'Line-item costs (one number per line)', { default: '200000\n80000\n50000', rows: 5 }), nf('cont', 'Contingency %', { default: 10 })],
    run: (v) => {
      const total = (v.t || '').split('\n').reduce((s, l) => s + (parseFloat(l) || 0), 0);
      return { out: `Subtotal: ${money(total)}\nContingency (${num(v.cont)}%): ${money(total * num(v.cont) / 100)}\nTotal budget: ${money(total * (1 + num(v.cont) / 100))}`, mono: true };
    },
  },

  /* ---------------- Accessibility ---------------- */
  'accessibility-color-contrast-checker': {
    fields: [text('fg', 'Text colour', { default: '#333333' }), text('bg', 'Background', { default: '#ffffff' })],
    run: (v) => SPECS['design-contrast-checker'].run(v),
  },
  'accessibility-readable-font-size-checker': {
    fields: [nf('px', 'Font size (px)', { default: 16 }), nf('dist', 'Viewing distance (cm)', { default: 50 })],
    run: (v) => {
      const ok = num(v.px) >= 16;
      return { out: `${num(v.px)}px is ${ok ? '✓ fine for body text' : '✗ small — use ≥16px for body'}\nAt ${num(v.dist)}cm, minimum comfortable ≈ ${fmt(num(v.dist) * 0.32, 0)}px`, mono: true };
    },
  },

  /* ---------------- Photography ---------------- */
  'photography-aspect-ratio-calculator': {
    fields: [nf('w', 'Width', { default: 1920 }), nf('h', 'Height', { default: 1080 })],
    run: (v) => {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const w = Math.round(num(v.w)), h = Math.round(num(v.h));
      if (!w || !h) return { out: '' };
      const g = gcd(w, h);
      return { out: `Ratio: ${w / g}:${h / g}\nDecimal: ${fmt(w / h, 3)}`, mono: true };
    },
  },
  'photography-dpi-calculator': {
    fields: [nf('w', 'Width (px)', { default: 3000 }), nf('h', 'Height (px)', { default: 2000 }), nf('dpi', 'DPI', { default: 300 })],
    run: (v) => {
      const dpi = num(v.dpi) || 300;
      return { out: `Print size at ${dpi} DPI:\n${fmt(num(v.w) / dpi, 2)} × ${fmt(num(v.h) / dpi, 2)} in\n${fmt((num(v.w) / dpi) * 2.54, 1)} × ${fmt((num(v.h) / dpi) * 2.54, 1)} cm`, mono: true };
    },
  },
  'photography-print-size-calculator': {
    fields: [nf('w', 'Width (px)', { default: 3000 }), nf('h', 'Height (px)', { default: 2000 }), sel('quality', 'Print quality', ['300 DPI (photo)', '150 DPI (poster)', '72 DPI (screen)'])],
    run: (v) => {
      const dpi = parseInt(v.quality) || 300;
      return { out: `At ${dpi} DPI → ${fmt(num(v.w) / dpi, 1)} × ${fmt(num(v.h) / dpi, 1)} inches`, mono: true };
    },
  },

  /* ---------------- Maps & Geography ---------------- */
  'maps-and-geography-coordinate-converter': {
    fields: [nf('lat', 'Latitude (decimal)', { default: 28.6139 }), nf('lng', 'Longitude (decimal)', { default: 77.209 })],
    run: (v) => {
      const dms = (d, pos, neg) => { const dir = d >= 0 ? pos : neg; d = Math.abs(d); const deg = Math.floor(d); const min = Math.floor((d - deg) * 60); const sec = ((d - deg) * 60 - min) * 60; return `${deg}°${min}'${fmt(sec, 1)}"${dir}`; };
      return { out: `${dms(num(v.lat), 'N', 'S')}  ${dms(num(v.lng), 'E', 'W')}`, mono: true };
    },
  },
  'maps-and-geography-distance-between-coordinates': {
    fields: [nf('lat1', 'Lat 1', { default: 28.6139 }), nf('lng1', 'Lng 1', { default: 77.209 }), nf('lat2', 'Lat 2', { default: 19.076 }), nf('lng2', 'Lng 2', { default: 72.8777 })],
    run: (v) => {
      const R = 6371, rad = (x) => (x * Math.PI) / 180;
      const dLat = rad(num(v.lat2) - num(v.lat1)), dLng = rad(num(v.lng2) - num(v.lng1));
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(num(v.lat1))) * Math.cos(rad(num(v.lat2))) * Math.sin(dLng / 2) ** 2;
      const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return { out: `Distance: ${fmt(km, 2)} km  (${fmt(km * 0.621371, 2)} miles)`, mono: true, note: 'Straight-line (great-circle) distance.' };
    },
  },
  'maps-and-geography-latitude-longitude-formatter': {
    fields: [nf('lat', 'Latitude', { default: 28.6139 }), nf('lng', 'Longitude', { default: 77.209 })],
    run: (v) => SPECS['maps-and-geography-coordinate-converter'].run(v),
  },

  /* ---------------- Email ---------------- */
  'email-email-validator': {
    fields: [area('t', 'Emails (one per line)', { default: 'amit@example.com\nbad@@mail\nbina@site.co.in', rows: 6 })],
    run: (v) => {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const rows = (v.t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((e) => `${re.test(e) ? '✓' : '✗'}  ${e}`);
      return { out: rows.join('\n'), mono: true };
    },
  },
  'email-email-signature-generator': {
    fields: [text('name', 'Name', { default: 'Amit Kumar' }), text('title', 'Job title', { default: 'Product Manager' }), text('co', 'Company', { default: 'Acme Inc.' }), text('phone', 'Phone', { default: '+91 90000 00000' }), text('mail', 'Email', { default: 'amit@acme.com' })],
    run: (v) => ({ out: `${v.name}\n${v.title} · ${v.co}\n${v.phone} | ${v.mail}\n—\n${v.co}`, note: 'Copy into your email client’s signature settings.' }),
  },

  /* ---------------- Business ---------------- */
  'business-business-name-generator': {
    fields: [text('kw', 'Keyword', { default: 'green' }), text('kw2', 'Second word', { default: 'leaf' })],
    run: (v) => {
      const a = (v.kw || '').trim(), b = (v.kw2 || '').trim();
      const pre = ['Go', 'Get', 'My', 'The', 'Try', 'Neo', 'Pro'];
      const suf = ['ly', 'ify', 'Hub', 'Lab', 'Works', 'HQ', 'Spot', 'Zone'];
      const names = new Set();
      pre.forEach((p) => names.add(p + cap(a)));
      suf.forEach((s) => names.add(cap(a) + s));
      if (b) { names.add(cap(a) + cap(b)); names.add(cap(b) + cap(a)); suf.forEach((s) => names.add(cap(a) + cap(b) + s)); }
      return { out: [...names].slice(0, 24).join('\n') };
    },
  },
  'business-slogan-generator': {
    fields: [text('brand', 'Brand', { default: 'Acme' }), text('kw', 'Keyword', { default: 'coffee' })],
    run: (v) => {
      const B = v.brand || 'Brand', k = (v.kw || 'quality').toLowerCase();
      return {
        out: [
          `${B}. ${cap(k)} done right.`,
          `Think ${k}. Think ${B}.`,
          `${B} — your ${k}, perfected.`,
          `The future of ${k}.`,
          `${cap(k)} you can trust, from ${B}.`,
          `Life's better with ${B}.`,
          `${B}: simply ${k}.`,
          `Where ${k} meets quality.`,
        ].join('\n'),
      };
    },
  },

  /* ---------------- Productivity ---------------- */
  'productivity-meeting-cost-calculator': {
    fields: [nf('people', 'Attendees', { default: 6 }), nf('rate', 'Avg hourly rate', { default: 800 }), nf('min', 'Duration (minutes)', { default: 60 })],
    run: (v) => {
      const cost = num(v.people) * num(v.rate) * (num(v.min) / 60);
      return { out: `Meeting cost: ${money(cost)}\nPer minute: ${money(cost / (num(v.min) || 1))}`, mono: true };
    },
  },

  /* ---------------- Education ---------------- */
  'education-exam-countdown-calculator': {
    fields: [date('d', 'Exam date')],
    run: (v) => {
      if (!v.d) return { out: '' };
      const days = Math.ceil((new Date(v.d) - new Date()) / 86400000);
      return { out: days > 0 ? `${days} days left\n= ${fmt(days / 7, 1)} weeks of prep` : days === 0 ? 'Exam is today!' : 'Date has passed.', mono: true };
    },
  },

  /* ---------------- Text (remaining) ---------------- */
  'text-text-encryptor': {
    fields: [area('t', 'Text to encrypt'), text('key', 'Passphrase', { default: 'mytrack' })],
    run: (v) => { try { return { out: b64enc(xorCipher(v.t || '', v.key)), mono: true, note: 'Obfuscation for casual privacy — not strong encryption. Keep the passphrase to decrypt.' }; } catch (e) { return { error: e.message }; } },
  },
  'text-text-decryptor': {
    fields: [area('t', 'Encrypted text'), text('key', 'Passphrase', { default: 'mytrack' })],
    run: (v) => { if (!v.t) return { out: '' }; try { return { out: xorCipher(b64dec(v.t), v.key) }; } catch { return { error: 'Could not decrypt — check the text and passphrase.' }; } },
  },
  'text-markdown-formatter': {
    fields: [area('t', 'Markdown', { rows: 8 })],
    run: (v) => {
      const out = (v.t || '').split('\n').map((l) => l
        .replace(/^(#{1,6})([^#\s])/, '$1 $2')       // space after #
        .replace(/^\s*[*+]\s+/, '- ')                 // normalise bullets to -
        .replace(/\s+$/, '')                           // trailing spaces
      ).join('\n').replace(/\n{3,}/g, '\n\n');
      return { out, mono: true };
    },
  },
  'text-markdown-previewer': {
    fields: [area('t', 'Markdown', { rows: 8, default: '# Hello\n\nSome **bold** and *italic* text with `code`.\n\n- one\n- two' })],
    run: (v) => ({ out: mdToHtml(v.t || ''), mono: true, note: 'Rendered HTML source.' }),
  },

  /* ---------------- Websites (generators) ---------------- */
  'websites-meta-tag-generator': {
    fields: [text('title', 'Page title', { default: 'My Page' }), area('desc', 'Description', { rows: 3, default: 'A short description of the page.' }), text('url', 'Canonical URL', { default: 'https://example.com' }), text('img', 'Social image URL', { default: 'https://example.com/og.png' })],
    run: (v) => ({
      out:
`<title>${v.title}</title>
<meta name="description" content="${v.desc}">
<link rel="canonical" href="${v.url}">
<meta property="og:title" content="${v.title}">
<meta property="og:description" content="${v.desc}">
<meta property="og:url" content="${v.url}">
<meta property="og:image" content="${v.img}">
<meta name="twitter:card" content="summary_large_image">`,
      mono: true,
    }),
  },
  'websites-robots-txt-generator': {
    fields: [sel('mode', 'Default rule', ['Allow all', 'Block all']), area('disallow', 'Disallow paths (one per line)', { rows: 4, default: '/admin\n/private' }), text('sitemap', 'Sitemap URL', { default: 'https://example.com/sitemap.xml' })],
    run: (v) => {
      const lines = ['User-agent: *'];
      if (v.mode === 'Block all') lines.push('Disallow: /');
      else { (v.disallow || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((p) => lines.push('Disallow: ' + p)); if (lines.length === 1) lines.push('Disallow:'); }
      if (v.sitemap) lines.push('', 'Sitemap: ' + v.sitemap);
      return { out: lines.join('\n'), mono: true };
    },
  },
  'websites-sitemap-generator': {
    fields: [area('t', 'URLs (one per line)', { rows: 6, default: 'https://example.com/\nhttps://example.com/about\nhttps://example.com/contact' })],
    run: (v) => {
      const urls = (v.t || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const today = new Date().toISOString().slice(0, 10);
      const body = urls.map((u) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n');
      return { out: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`, mono: true, note: `${urls.length} URLs` };
    },
  },
  'websites-open-graph-previewer': {
    fields: [text('title', 'og:title', { default: 'My Article Title' }), area('desc', 'og:description', { rows: 3, default: 'A compelling summary that shows under the title in social shares.' }), text('url', 'og:url', { default: 'example.com/article' })],
    run: (v) => {
      const t = (v.title || '').length, d = (v.desc || '').length;
      return { out: `Title: ${t} chars ${t <= 60 ? '✓' : '✗ aim ≤60'}\nDescription: ${d} chars ${d >= 55 && d <= 200 ? '✓' : '✗ aim 55–200'}\n\n┌─────────────────────────────┐\n│ ${(v.title || '').slice(0, 29)}\n│ ${(v.desc || '').slice(0, 29)}…\n│ ${(v.url || '').toUpperCase().slice(0, 29)}\n└─────────────────────────────┘`, mono: true };
    },
  },

  /* ---------------- QR & Barcodes (validators) ---------------- */
  'qr-and-barcodes-ean-validator': {
    fields: [text('code', 'EAN-13 code', { default: '4006381333931' })],
    run: (v) => {
      const d = (v.code || '').replace(/\D/g, '');
      if (d.length !== 13) return { error: 'EAN-13 must be exactly 13 digits.' };
      let sum = 0; for (let i = 0; i < 12; i++) sum += +d[i] * (i % 2 === 0 ? 1 : 3);
      const chk = (10 - (sum % 10)) % 10;
      return { out: `Check digit: ${chk}\n${chk === +d[12] ? '✓ Valid EAN-13' : `✗ Invalid — last digit should be ${chk}`}`, mono: true };
    },
  },
  'qr-and-barcodes-upc-validator': {
    fields: [text('code', 'UPC-A code', { default: '036000291452' })],
    run: (v) => {
      const d = (v.code || '').replace(/\D/g, '');
      if (d.length !== 12) return { error: 'UPC-A must be exactly 12 digits.' };
      let sum = 0; for (let i = 0; i < 11; i++) sum += +d[i] * (i % 2 === 0 ? 3 : 1);
      const chk = (10 - (sum % 10)) % 10;
      return { out: `Check digit: ${chk}\n${chk === +d[11] ? '✓ Valid UPC-A' : `✗ Invalid — last digit should be ${chk}`}`, mono: true };
    },
  },

  /* ---------------- Spreadsheets / CSV ---------------- */
  'spreadsheets-csv-previewer': {
    fields: [area('t', 'CSV', { rows: 7, default: 'name,age,city\nAmit,29,Delhi\nBina,34,Mumbai' })],
    run: (v) => {
      const rows = parseCSV(v.t || '');
      if (!rows.length) return { out: '' };
      const w = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? '').length)));
      const line = (r) => r.map((c, i) => String(c ?? '').padEnd(w[i])).join(' │ ');
      const sep = w.map((x) => '─'.repeat(x)).join('─┼─');
      return { out: [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n'), mono: true, note: `${rows.length - 1} rows × ${rows[0].length} columns` };
    },
  },
  'spreadsheets-table-formatter': {
    fields: [area('t', 'CSV', { rows: 6, default: 'name,age\nAmit,29\nBina,34' })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); if (rows.length < 1) return { out: '' };
      const md = ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |')];
      return { out: md.join('\n'), mono: true, note: 'Markdown table' };
    },
  },
  'spreadsheets-duplicate-row-finder': {
    fields: [area('t', 'CSV', { rows: 7 })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); const seen = new Map(); const dups = [];
      rows.forEach((r, i) => { const k = r.join('\u0001'); if (seen.has(k)) dups.push(`Row ${i + 1} duplicates row ${seen.get(k) + 1}: ${r.join(', ')}`); else seen.set(k, i); });
      return { out: dups.length ? dups.join('\n') : 'No duplicate rows found.', mono: true, note: `${dups.length} duplicates` };
    },
  },
  'spreadsheets-duplicate-remover': {
    fields: [area('t', 'CSV', { rows: 7 })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); const seen = new Set(); const out = [];
      for (const r of rows) { const k = r.join('\u0001'); if (!seen.has(k)) { seen.add(k); out.push(r); } }
      return { out: toCSV(out), mono: true, note: `${rows.length - out.length} removed, ${out.length} kept` };
    },
  },
  'spreadsheets-blank-row-remover': {
    fields: [area('t', 'CSV', { rows: 7 })],
    run: (v) => {
      const rows = parseCSV(v.t || '').filter((r) => r.some((c) => String(c).trim() !== ''));
      return { out: toCSV(rows), mono: true, note: `${rows.length} rows kept` };
    },
  },
  'spreadsheets-data-cleaner': {
    fields: [area('t', 'CSV', { rows: 7 }), chk('trim', 'Trim cells', { default: true }), chk('collapse', 'Collapse inner spaces', { default: true }), chk('blank', 'Remove blank rows', { default: true })],
    run: (v) => {
      let rows = parseCSV(v.t || '').map((r) => r.map((c) => { let s = String(c ?? ''); if (v.trim) s = s.trim(); if (v.collapse) s = s.replace(/\s+/g, ' '); return s; }));
      if (v.blank) rows = rows.filter((r) => r.some((c) => c !== ''));
      return { out: toCSV(rows), mono: true };
    },
  },
  'spreadsheets-column-merger': {
    fields: [area('t', 'CSV', { rows: 6, default: 'first,last\nAmit,Kumar\nBina,Shah' }), nf('a', 'Column A (number)', { default: 1 }), nf('b', 'Column B (number)', { default: 2 }), text('sep', 'Join with', { default: ' ' }), text('name', 'New column name', { default: 'merged' })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); const a = num(v.a) - 1, b = num(v.b) - 1;
      const out = rows.map((r, i) => [...r, i === 0 ? v.name : `${r[a] ?? ''}${v.sep}${r[b] ?? ''}`]);
      return { out: toCSV(out), mono: true };
    },
  },
  'spreadsheets-column-splitter': {
    fields: [area('t', 'CSV', { rows: 6, default: 'name\nAmit Kumar\nBina Shah' }), nf('col', 'Column (number)', { default: 1 }), text('sep', 'Split on', { default: ' ' })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); const c = num(v.col) - 1; const sep = (v.sep || ' ').replace(/\\t/g, '\t');
      const maxParts = Math.max(...rows.slice(1).map((r) => String(r[c] ?? '').split(sep).length), 1);
      const out = rows.map((r, i) => {
        const parts = i === 0 ? Array.from({ length: maxParts }, (_, k) => `${r[c]}_${k + 1}`) : String(r[c] ?? '').split(sep);
        while (parts.length < maxParts) parts.push('');
        return [...r.slice(0, c), ...parts, ...r.slice(c + 1)];
      });
      return { out: toCSV(out), mono: true };
    },
  },

  /* ---------------- Data & Analytics (CSV) ---------------- */
  'data-and-analytics-csv-viewer': {
    fields: [area('t', 'CSV', { rows: 7, default: 'name,age,city\nAmit,29,Delhi\nBina,34,Mumbai' })],
    run: (v) => SPECS['spreadsheets-csv-previewer'].run(v),
  },
  'data-and-analytics-csv-cleaner': {
    fields: [area('t', 'CSV', { rows: 7 }), chk('trim', 'Trim cells', { default: true }), chk('collapse', 'Collapse inner spaces', { default: true }), chk('blank', 'Remove blank rows', { default: true })],
    run: (v) => SPECS['spreadsheets-data-cleaner'].run(v),
  },
  'data-and-analytics-data-deduplicator': {
    fields: [area('t', 'CSV', { rows: 7 })],
    run: (v) => SPECS['spreadsheets-duplicate-remover'].run(v),
  },
  'data-and-analytics-json-to-csv-converter': {
    fields: [area('t', 'JSON array of objects', { rows: 7, default: '[{"name":"Amit","age":29},{"name":"Bina","age":34}]' })],
    run: (v) => {
      try {
        const arr = JSON.parse(v.t || '[]');
        if (!Array.isArray(arr) || !arr.length) return { error: 'Provide a non-empty JSON array of objects.' };
        const cols = [...new Set(arr.flatMap((o) => Object.keys(o)))];
        return { out: toCSV([cols, ...arr.map((o) => cols.map((c) => o[c]))]), mono: true };
      } catch (e) { return { error: 'Invalid JSON: ' + e.message }; }
    },
  },
  'data-and-analytics-data-type-detector': {
    fields: [area('t', 'CSV', { rows: 7, default: 'name,age,email,joined\nAmit,29,a@x.com,2024-01-05' })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); if (rows.length < 2) return { out: '' };
      const detect = (s) => s === '' ? 'empty' : /^-?\d+$/.test(s) ? 'integer' : /^-?\d*\.\d+$/.test(s) ? 'decimal' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? 'email' : /^\d{4}-\d{2}-\d{2}/.test(s) ? 'date' : /^(true|false|yes|no)$/i.test(s) ? 'boolean' : 'text';
      const out = rows[0].map((h, c) => {
        const types = [...new Set(rows.slice(1).map((r) => detect(String(r[c] ?? '').trim())).filter((t) => t !== 'empty'))];
        return `${h}: ${types.join(' / ') || 'empty'}`;
      });
      return { out: out.join('\n'), mono: true };
    },
  },
  'data-and-analytics-phone-number-formatter': {
    fields: [area('t', 'Phone numbers (one per line)', { rows: 5, default: '9876543210\n+91 98765 43210\n(022) 1234 5678' }), text('cc', 'Default country code', { default: '+91' })],
    run: (v) => {
      const out = (v.t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((raw) => {
        const plus = raw.trim().startsWith('+');
        const digits = raw.replace(/\D/g, '');
        if (plus) return '+' + digits;
        if (digits.length === 10) return `${v.cc} ${digits.slice(0, 5)} ${digits.slice(5)}`;
        return `${v.cc} ${digits}`;
      });
      return { out: out.join('\n'), mono: true };
    },
  },
  'data-and-analytics-sample-data-generator': {
    fields: [nf('rows', 'Rows', { default: 10 }), text('cols', 'Columns', { default: 'name,email,age,city' })],
    run: (v) => {
      const first = 'Amit,Bina,Chetan,Diya,Esha,Farhan,Gita,Hari,Isha,Jay,Kiran,Lata'.split(',');
      const last = 'Kumar,Shah,Rao,Singh,Patel,Nair,Das,Roy,Khan,Mehta'.split(',');
      const cities = 'Delhi,Mumbai,Pune,Jaipur,Chennai,Kolkata,Surat,Indore'.split(',');
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const cols = (v.cols || 'name').split(',').map((c) => c.trim());
      const n = Math.min(1000, Math.max(1, num(v.rows)));
      const rows = [cols];
      for (let i = 0; i < n; i++) {
        const f = pick(first), l = pick(last);
        rows.push(cols.map((c) => {
          const k = c.toLowerCase();
          if (k.includes('email')) return `${f.toLowerCase()}.${l.toLowerCase()}@example.com`;
          if (k.includes('name')) return `${f} ${l}`;
          if (k.includes('age')) return String(18 + Math.floor(Math.random() * 50));
          if (k.includes('city')) return pick(cities);
          if (k.includes('phone')) return '+91 9' + Math.floor(100000000 + Math.random() * 899999999);
          if (k.includes('id')) return String(1000 + i);
          if (k.includes('price') || k.includes('amount')) return String((Math.random() * 5000).toFixed(2));
          return 'value' + (i + 1);
        }));
      }
      return { out: toCSV(rows), mono: true, note: `${n} rows` };
    },
  },
  'data-and-analytics-random-dataset-generator': {
    fields: [nf('rows', 'Rows', { default: 10 }), text('cols', 'Columns', { default: 'id,name,email,amount' })],
    run: (v) => SPECS['data-and-analytics-sample-data-generator'].run(v),
  },
  'data-and-analytics-data-validator': {
    fields: [area('t', 'CSV', { rows: 7, default: 'name,email,age\nAmit,amit@x.com,29\nBina,,bad' }), text('required', 'Required columns (comma-separated)', { default: 'name,email' })],
    run: (v) => {
      const rows = parseCSV(v.t || ''); if (rows.length < 2) return { out: '' };
      const header = rows[0]; const req = (v.required || '').split(',').map((s) => s.trim()).filter(Boolean);
      const issues = [];
      req.forEach((r) => { if (!header.includes(r)) issues.push(`Missing column: ${r}`); });
      rows.slice(1).forEach((row, i) => {
        req.forEach((r) => { const c = header.indexOf(r); if (c >= 0 && String(row[c] ?? '').trim() === '') issues.push(`Row ${i + 2}: "${r}" is empty`); });
        const ec = header.findIndex((h) => /email/i.test(h));
        if (ec >= 0 && row[ec] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row[ec])) issues.push(`Row ${i + 2}: invalid email "${row[ec]}"`);
      });
      return { out: issues.length ? issues.join('\n') : '✓ All rows valid.', mono: true, note: `${issues.length} issues` };
    },
  },

  /* ---------------- Documents (more) ---------------- */
  'documents-page-counter': {
    fields: [area('t', 'Text', { rows: 7 }), nf('wpp', 'Words per page', { default: 250 })],
    run: (v) => {
      const words = ((v.t || '').match(/\S+/g) || []).length;
      return { out: `Words: ${words}\nPages: ~${Math.max(1, Math.ceil(words / (num(v.wpp) || 250)))} (at ${num(v.wpp) || 250}/page)`, mono: true };
    },
  },
  'documents-readability-checker': {
    fields: [area('t', 'Text', { rows: 6 })],
    run: (v) => SPECS['seo-readability-analyzer'].run(v),
  },
  'documents-citation-formatter': {
    fields: [text('author', 'Author', { default: 'Sharma, R.' }), text('year', 'Year', { default: '2026' }), text('title', 'Title', { default: 'Understanding Tools' }), text('source', 'Source / Publisher', { default: 'MyTrack Press' }), sel('style', 'Style', ['APA', 'MLA', 'Chicago'])],
    run: (v) => {
      const a = v.author, y = v.year, t = v.title, s = v.source;
      let out;
      if (v.style === 'MLA') out = `${a}. "${t}." ${s}, ${y}.`;
      else if (v.style === 'Chicago') out = `${a}. ${y}. "${t}." ${s}.`;
      else out = `${a} (${y}). ${t}. ${s}.`;
      return { out };
    },
  },
  'documents-redaction-tool': {
    fields: [area('t', 'Text', { rows: 6 }), text('words', 'Words/phrases to redact (comma-separated)', { default: 'secret, password' })],
    run: (v) => {
      let out = v.t || '';
      (v.words || '').split(',').map((w) => w.trim()).filter(Boolean).forEach((w) => {
        out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => '█'.repeat(m.length));
      });
      // also redact emails & long digit runs
      out = out.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, (m) => '█'.repeat(m.length)).replace(/\b\d{6,}\b/g, (m) => '█'.repeat(m.length));
      return { out };
    },
  },
  'documents-template-generator': {
    fields: [sel('type', 'Template', ['Meeting agenda', 'Business letter', 'Project brief', 'Invoice note'])],
    run: (v) => {
      const T = {
        'Meeting agenda': `MEETING AGENDA\nDate: ____  Time: ____\nAttendees: ____\n\n1. Welcome & objectives\n2. Review of action items\n3. Discussion topics\n   - \n4. Decisions\n5. Next steps & owners\n6. Next meeting date`,
        'Business letter': `[Your Name]\n[Address]\n[Date]\n\n[Recipient Name]\n[Company]\n\nDear [Name],\n\n[Opening — purpose of the letter.]\n\n[Body — details.]\n\n[Closing — call to action.]\n\nالسincerely,\n[Your Name]`.replace('السincerely', 'Sincerely'),
        'Project brief': `PROJECT BRIEF\nProject: ____\nOwner: ____  Date: ____\n\nBackground:\nGoals:\nScope (in / out):\nDeliverables:\nTimeline / milestones:\nBudget:\nRisks:\nSuccess metrics:`,
        'Invoice note': `Thank you for your business!\nPayment due within 15 days.\nBank: ____  Account: ____\nQuestions? Email ____`,
      };
      return { out: T[v.type] || '', mono: true };
    },
  },

  /* ---------------- SEO (more) ---------------- */
  'seo-heading-analyzer': {
    fields: [area('t', 'HTML or Markdown', { rows: 7, default: '# Title\n## Section A\n### Detail\n## Section B' })],
    run: (v) => {
      const t = v.t || ''; const heads = [];
      const htmlRe = /<h([1-6])[^>]*>(.*?)<\/h\1>/gis; let m;
      while ((m = htmlRe.exec(t))) heads.push([+m[1], m[2].replace(/<[^>]+>/g, '').trim()]);
      if (!heads.length) for (const line of t.split('\n')) { const h = /^(#{1,6})\s+(.*)/.exec(line.trim()); if (h) heads.push([h[1].length, h[2]]); }
      if (!heads.length) return { out: 'No headings found.' };
      const h1 = heads.filter((h) => h[0] === 1).length;
      const issues = [];
      if (h1 === 0) issues.push('⚠ No H1 found');
      if (h1 > 1) issues.push(`⚠ ${h1} H1s (use exactly one)`);
      for (let i = 1; i < heads.length; i++) if (heads[i][0] - heads[i - 1][0] > 1) issues.push(`⚠ Level jumps H${heads[i - 1][0]}→H${heads[i][0]} ("${heads[i][1]}")`);
      return { out: heads.map((h) => '  '.repeat(h[0] - 1) + `H${h[0]}: ${h[1]}`).join('\n') + '\n\n' + (issues.length ? issues.join('\n') : '✓ Structure looks good.'), mono: true };
    },
  },
  'seo-image-alt-checker': {
    fields: [area('t', 'HTML', { rows: 7, default: '<img src="a.jpg" alt="A cat">\n<img src="b.jpg">' })],
    run: (v) => {
      const imgs = (v.t || '').match(/<img\b[^>]*>/gi) || [];
      if (!imgs.length) return { out: 'No <img> tags found.' };
      const rows = imgs.map((tag) => { const alt = /alt\s*=\s*"(.*?)"/i.exec(tag); const src = /src\s*=\s*"(.*?)"/i.exec(tag); return `${alt && alt[1].trim() ? '✓' : '✗'} ${src ? src[1] : tag.slice(0, 30)}${alt && alt[1].trim() ? '  alt="' + alt[1] + '"' : '  (missing alt)'}`; });
      const missing = rows.filter((r) => r.startsWith('✗')).length;
      return { out: rows.join('\n'), mono: true, note: `${imgs.length} images, ${missing} missing alt` };
    },
  },
  'seo-schema-generator': {
    fields: [sel('type', 'Type', ['Article', 'Product', 'FAQPage', 'Organization']), text('name', 'Name / Title', { default: 'My Thing' }), text('desc', 'Description', { default: 'A description.' }), text('url', 'URL', { default: 'https://example.com' })],
    run: (v) => {
      const base = { '@context': 'https://schema.org', '@type': v.type, name: v.name, description: v.desc, url: v.url };
      if (v.type === 'Product') base.offers = { '@type': 'Offer', priceCurrency: 'INR', price: '0' };
      if (v.type === 'FAQPage') base.mainEntity = [{ '@type': 'Question', name: v.name, acceptedAnswer: { '@type': 'Answer', text: v.desc } }];
      return { out: '<script type="application/ld+json">\n' + JSON.stringify(base, null, 2) + '\n</script>', mono: true };
    },
  },
  'seo-keyword-grouper': {
    fields: [area('t', 'Keywords (one per line)', { rows: 7, default: 'buy shoes\nbuy shoes online\nrunning shoes\nrunning shoes men\ncheap shoes' })],
    run: (v) => {
      const kws = (v.t || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const groups = {};
      for (const k of kws) { const head = k.split(/\s+/)[0].toLowerCase(); (groups[head] = groups[head] || []).push(k); }
      return { out: Object.entries(groups).map(([g, items]) => `${g} (${items.length}):\n  ${items.join('\n  ')}`).join('\n\n'), mono: true };
    },
  },

  /* ---------------- Websites (more) ---------------- */
  'websites-structured-data-tester': {
    fields: [area('t', 'JSON-LD', { rows: 7, default: '{"@context":"https://schema.org","@type":"Article","name":"Hi"}' })],
    run: (v) => {
      let src = (v.t || '').replace(/<\/?script[^>]*>/gi, '').trim();
      try {
        const o = JSON.parse(src);
        const issues = [];
        if (!o['@context']) issues.push('⚠ missing @context');
        if (!o['@type']) issues.push('⚠ missing @type');
        return { out: `✓ Valid JSON\n@type: ${o['@type'] || '—'}\n` + (issues.length ? issues.join('\n') : '✓ Has required keys'), mono: true };
      } catch (e) { return { error: 'Invalid JSON-LD: ' + e.message }; }
    },
  },
  'websites-canonical-url-checker': {
    fields: [area('t', 'HTML <head>', { rows: 6, default: '<link rel="canonical" href="https://example.com/page">' })],
    run: (v) => {
      const m = (v.t || '').match(/<link[^>]*rel=["']canonical["'][^>]*>/i);
      if (!m) return { out: '✗ No canonical tag found.' };
      const href = /href=["'](.*?)["']/i.exec(m[0]);
      return { out: `✓ Canonical found:\n${href ? href[1] : '(no href!)'}`, mono: true };
    },
  },
  'websites-html-validator': {
    fields: [area('t', 'HTML', { rows: 7, default: '<div><p>Hello</p></div>' })],
    run: (v) => {
      const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
      const stack = []; const errs = []; const re = /<\/?([a-zA-Z0-9]+)[^>]*?(\/?)>/g; let m;
      while ((m = re.exec(v.t || ''))) {
        const tag = m[1].toLowerCase(); const closing = m[0][1] === '/'; const self = m[2] === '/' || voids.has(tag);
        if (self) continue;
        if (!closing) stack.push(tag);
        else { if (stack[stack.length - 1] === tag) stack.pop(); else errs.push(`Unexpected </${tag}>`); }
      }
      stack.forEach((t) => errs.push(`Unclosed <${t}>`));
      return { out: errs.length ? errs.join('\n') : '✓ Tags are balanced.', mono: true, note: `${errs.length} issues` };
    },
  },

  /* ---------------- Security (more) ---------------- */
  'security-and-privacy-secret-scanner': {
    fields: [area('t', 'Code / text to scan', { rows: 7, default: 'const k = "AKIAIOSFODNN7EXAMPLE";\napi_key=sk_live_abc123;' })],
    run: (v) => {
      const pats = [[/AKIA[0-9A-Z]{16}/g, 'AWS Access Key'], [/AIza[0-9A-Za-z\-_]{35}/g, 'Google API Key'], [/sk_live_[0-9a-zA-Z]{10,}/g, 'Stripe live key'], [/gh[pousr]_[0-9A-Za-z]{20,}/g, 'GitHub token'], [/(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[\w\-]{8,}/gi, 'Generic secret'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'Private key']];
      const hits = [];
      for (const [re, name] of pats) { const m = (v.t || '').match(re); if (m) m.forEach((x) => hits.push(`⚠ ${name}: ${x.slice(0, 40)}…`)); }
      return { out: hits.length ? hits.join('\n') : '✓ No obvious secrets found.', mono: true, note: `${hits.length} findings` };
    },
  },
  'security-and-privacy-pii-detection-helper': {
    fields: [area('t', 'Text to scan', { rows: 7, default: 'Call me at 9876543210 or amit@example.com. Card 4111 1111 1111 1111.' })],
    run: (v) => {
      const t = v.t || ''; const out = [];
      const add = (re, label) => { const m = t.match(re); if (m) out.push(`${label}: ${[...new Set(m)].join(', ')}`); };
      add(/[^\s@]+@[^\s@]+\.[^\s@]+/g, 'Emails');
      add(/\b(?:\+?\d{1,3}[\s-]?)?\d{10}\b/g, 'Phone numbers');
      add(/\b(?:\d[ -]*?){13,16}\b/g, 'Card-like numbers');
      add(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, 'Aadhaar-like');
      return { out: out.length ? out.join('\n') : '✓ No obvious PII found.', mono: true };
    },
  },
  'security-and-privacy-email-header-analyzer': {
    fields: [area('t', 'Paste raw email headers', { rows: 8, default: 'From: a@x.com\nTo: b@y.com\nSubject: Hi\nDate: Mon, 1 Jan 2026 10:00:00\nReceived: from mail.x.com' })],
    run: (v) => {
      const get = (k) => { const m = new RegExp('^' + k + ':\\s*(.*)$', 'im').exec(v.t || ''); return m ? m[1].trim() : '—'; };
      const hops = (v.t || '').match(/^Received:/gim) || [];
      return { out: `From: ${get('From')}\nTo: ${get('To')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}\nSPF: ${get('Received-SPF')}\nReceived hops: ${hops.length}`, mono: true };
    },
  },

  /* ---------------- Files & Archives ---------------- */
  'files-and-archives-mime-type-lookup': {
    fields: [text('ext', 'File extension or name', { default: '.png' })],
    run: (v) => {
      const M = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', json: 'application/json', csv: 'text/csv', txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      const ext = (v.ext || '').split('.').pop().toLowerCase();
      return { out: M[ext] ? `${ext} → ${M[ext]}` : `Unknown extension: ${ext}`, mono: true };
    },
  },
  'files-and-archives-file-type-detector': {
    fields: [text('ext', 'File name or extension', { default: 'photo.jpg' })],
    run: (v) => {
      const C = { image: 'png,jpg,jpeg,gif,webp,svg,bmp,tiff,heic', video: 'mp4,mov,avi,mkv,webm,flv', audio: 'mp3,wav,ogg,flac,aac,m4a', document: 'pdf,doc,docx,txt,rtf,odt', spreadsheet: 'csv,xls,xlsx,ods', archive: 'zip,rar,7z,tar,gz', code: 'js,ts,py,java,c,cpp,html,css,json,xml' };
      const ext = (v.ext || '').split('.').pop().toLowerCase();
      const cat = Object.entries(C).find(([, exts]) => exts.split(',').includes(ext));
      return { out: cat ? `${ext} → ${cat[0]} file` : `Unknown type: ${ext}`, mono: true };
    },
  },

  /* ---------------- Education / Business / Marketing / Finance ---------------- */
  'education-citation-generator': {
    fields: [text('author', 'Author', { default: 'Sharma, R.' }), text('year', 'Year', { default: '2026' }), text('title', 'Title', { default: 'My Paper' }), text('source', 'Source', { default: 'Journal' }), sel('style', 'Style', ['APA', 'MLA', 'Chicago'])],
    run: (v) => SPECS['documents-citation-formatter'].run(v),
  },
  'education-flashcard-maker': {
    fields: [area('t', 'One per line:  question | answer', { rows: 7, default: 'Capital of France | Paris\n2 + 2 | 4' })],
    run: (v) => {
      const cards = (v.t || '').split('\n').map((l) => l.split('|')).filter((p) => p.length === 2);
      return { out: cards.map((c, i) => `Card ${i + 1}\n  Q: ${c[0].trim()}\n  A: ${c[1].trim()}`).join('\n\n'), mono: true, note: `${cards.length} cards` };
    },
  },
  'e-commerce-sku-generator': {
    fields: [text('prefix', 'Prefix', { default: 'TSH' }), area('t', 'Variants (one per line, comma attributes)', { rows: 5, default: 'Red,S\nRed,M\nBlue,L' })],
    run: (v) => {
      const out = (v.t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (v.prefix ? v.prefix + '-' : '') + l.split(',').map((a) => a.trim().toUpperCase().replace(/\s+/g, '').slice(0, 4)).join('-'));
      return { out: out.join('\n'), mono: true, note: `${out.length} SKUs` };
    },
  },
  'business-meeting-minutes-generator': {
    fields: [text('title', 'Meeting', { default: 'Weekly sync' }), text('date', 'Date', { default: '' }), area('attendees', 'Attendees (one per line)', { rows: 3, default: 'Amit\nBina' }), area('points', 'Discussion points (one per line)', { rows: 4, default: 'Reviewed roadmap\nAgreed on launch date' }), area('actions', 'Action items (one per line)', { rows: 3, default: 'Amit: finalise design' })],
    run: (v) => {
      const list = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
      return {
        out: `MEETING MINUTES — ${v.title}\nDate: ${v.date || new Date().toISOString().slice(0, 10)}\n\nAttendees:\n${list(v.attendees).map((a) => '  • ' + a).join('\n')}\n\nDiscussion:\n${list(v.points).map((p, i) => `  ${i + 1}. ${p}`).join('\n')}\n\nAction items:\n${list(v.actions).map((a) => '  ☐ ' + a).join('\n')}`,
        mono: true,
      };
    },
  },
  'marketing-email-subject-tester': {
    fields: [text('t', 'Subject line', { default: 'Limited time: 50% OFF everything!!!' })],
    run: (v) => {
      const s = v.t || ''; const len = s.length;
      const spam = ['free', 'buy now', 'limited time', '100%', 'click here', 'act now', 'winner', 'cash', 'cheap', 'offer', 'discount', 'guarantee'];
      const hits = spam.filter((w) => s.toLowerCase().includes(w));
      const caps = (s.match(/[A-Z]/g) || []).length / (s.length || 1);
      return { out: `Length: ${len} chars ${len <= 50 ? '✓' : '✗ (aim ≤50 for mobile)'}\nSpam-trigger words: ${hits.length ? hits.join(', ') : 'none ✓'}\nALL-CAPS ratio: ${(caps * 100).toFixed(0)}% ${caps > 0.3 ? '✗ too shouty' : '✓'}\nExclamation marks: ${(s.match(/!/g) || []).length}`, mono: true };
    },
  },
  'finance-budget-planner': {
    fields: [nf('income', 'Monthly income', { default: 60000 }), area('t', 'Expenses: label,amount (one per line)', { rows: 6, default: 'Rent,18000\nFood,10000\nTransport,4000\nSavings,8000' })],
    run: (v) => {
      const rows = (v.t || '').split('\n').map((l) => l.split(',')).filter((p) => p.length >= 2);
      const total = rows.reduce((s, r) => s + (parseFloat(r[1]) || 0), 0);
      const bal = num(v.income) - total;
      return { out: rows.map((r) => `${r[0].trim()}: ${money(parseFloat(r[1]) || 0)}`).join('\n') + `\n\nTotal expenses: ${money(total)}\nIncome: ${money(num(v.income))}\nLeft over: ${money(bal)}  (${num(v.income) ? ((bal / num(v.income)) * 100).toFixed(0) : 0}%)`, mono: true };
    },
  },
  'finance-invoice-generator': {
    fields: [text('from', 'From', { default: 'My Company' }), text('to', 'Bill to', { default: 'Client Name' }), area('items', 'Items: description,qty,price (one per line)', { rows: 5, default: 'Design work,10,1500\nHosting,1,5000' }), nf('tax', 'Tax %', { default: 18 })],
    run: (v) => {
      const rows = (v.items || '').split('\n').map((l) => l.split(',')).filter((p) => p.length >= 3);
      let sub = 0;
      const lines = rows.map((r) => { const amt = (parseFloat(r[1]) || 0) * (parseFloat(r[2]) || 0); sub += amt; return `${r[0].trim().padEnd(24)} ${String(r[1].trim()).padStart(4)} × ${money(parseFloat(r[2]) || 0).padStart(10)} = ${money(amt)}`; });
      const tax = sub * num(v.tax) / 100;
      return { out: `INVOICE\nFrom: ${v.from}\nBill to: ${v.to}\nDate: ${new Date().toISOString().slice(0, 10)}\n\n${lines.join('\n')}\n\nSubtotal: ${money(sub)}\nTax (${num(v.tax)}%): ${money(tax)}\nTOTAL: ${money(sub + tax)}`, mono: true };
    },
  },

  /* ================= Hacking & CTF ================= */
  /* --- encodings --- */
  'hacking-and-ctf-base32-encoder': { fields: [area('input', 'Text', { default: 'Hello World!' })], run: (v) => ({ out: base32Encode(v.input || ''), mono: true }) },
  'hacking-and-ctf-base32-decoder': { fields: [area('input', 'Base32', { default: 'JBSWY3DPEBLW64TMMQQQ====' })], run: (v) => { try { return { out: base32Decode(v.input || '') }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-base58-encoder': { fields: [area('input', 'Text', { default: 'Hello World' })], run: (v) => ({ out: base58Encode(v.input || ''), mono: true }) },
  'hacking-and-ctf-base58-decoder': { fields: [area('input', 'Base58')], run: (v) => { try { return { out: base58Decode(v.input || '') }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-hex-encoder': { fields: [area('input', 'Text', { default: 'Hello' })], run: (v) => ({ out: Array.from(_enc(v.input || '')).map((b) => b.toString(16).padStart(2, '0')).join(''), mono: true }) },
  'hacking-and-ctf-hex-decoder': { fields: [area('input', 'Hex', { default: '48656c6c6f' })], run: (v) => { const hex = (v.input || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ''); if (hex.length % 2) return { error: 'Hex must have an even number of digits' }; const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16)); return { out: _dec(b) }; } },
  'hacking-and-ctf-binary-encoder': { fields: [area('input', 'Text', { default: 'Hi' })], run: (v) => ({ out: Array.from(_enc(v.input || '')).map((b) => b.toString(2).padStart(8, '0')).join(' '), mono: true }) },
  'hacking-and-ctf-binary-decoder': { fields: [area('input', 'Binary', { default: '01001000 01101001' })], run: (v) => { const bits = (v.input || '').replace(/[^01]/g, ''); if (bits.length % 8) return { error: 'Binary length must be a multiple of 8' }; const b = []; for (let i = 0; i < bits.length; i += 8) b.push(parseInt(bits.substr(i, 8), 2)); return { out: _dec(b) }; } },
  'hacking-and-ctf-octal-encoder': { fields: [area('input', 'Text', { default: 'Hi' })], run: (v) => ({ out: Array.from(_enc(v.input || '')).map((b) => b.toString(8).padStart(3, '0')).join(' '), mono: true }) },
  'hacking-and-ctf-octal-decoder': { fields: [area('input', 'Octal bytes', { default: '110 151' })], run: (v) => { const parts = (v.input || '').trim().split(/\s+/).filter(Boolean); try { return { out: _dec(parts.map((p) => { const n = parseInt(p, 8); if (isNaN(n) || n > 255) throw 0; return n; })) }; } catch { return { error: 'Enter space-separated octal byte values' }; } } },
  'hacking-and-ctf-decimal-encoder': { fields: [area('input', 'Text', { default: 'Hi' })], run: (v) => ({ out: Array.from(_enc(v.input || '')).join(' '), mono: true }) },
  'hacking-and-ctf-decimal-decoder': { fields: [area('input', 'Decimal bytes', { default: '72 105' })], run: (v) => { const parts = (v.input || '').trim().split(/[\s,]+/).filter(Boolean); try { return { out: _dec(parts.map((p) => { const n = parseInt(p, 10); if (isNaN(n) || n < 0 || n > 255) throw 0; return n; })) }; } catch { return { error: 'Enter space/comma-separated byte values 0–255' }; } } },
  'hacking-and-ctf-html-entity-encoder': { fields: [area('input', 'Text', { default: '<b>café & co</b>' })], run: (v) => ({ out: (v.input || '').replace(/[ -香<>&"']/g, (c) => '&#' + c.charCodeAt(0) + ';'), mono: true }) },
  'hacking-and-ctf-html-entity-decoder': { fields: [area('input', 'HTML entities', { default: '&lt;b&gt;caf&#233;&lt;/b&gt;' })], run: (v) => { const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®' }; return { out: (v.input || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m) }; } },
  'hacking-and-ctf-unicode-escape-encoder': { fields: [area('input', 'Text', { default: 'café ☕' })], run: (v) => { let o = ''; const s = v.input || ''; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o += c > 127 ? '\\u' + c.toString(16).padStart(4, '0') : s[i]; } return { out: o, mono: true }; } },
  'hacking-and-ctf-unicode-escape-decoder': { fields: [area('input', 'Escaped text', { default: 'caf\\u00e9 \\u2615' })], run: (v) => ({ out: (v.input || '').replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) }) },
  'hacking-and-ctf-quoted-printable-encoder': { fields: [area('input', 'Text', { default: 'Héllo=world' })], run: (v) => { const b = _enc(v.input || ''); let o = ''; for (const x of b) { if ((x >= 33 && x <= 126 && x !== 61) || x === 32 || x === 9) o += String.fromCharCode(x); else o += '=' + x.toString(16).toUpperCase().padStart(2, '0'); } return { out: o, mono: true }; } },
  'hacking-and-ctf-quoted-printable-decoder': { fields: [area('input', 'Quoted-printable', { default: 'H=C3=A9llo=3Dworld' })], run: (v) => { const s = (v.input || '').replace(/=\r?\n/g, ''); const b = []; for (let i = 0; i < s.length; i++) { if (s[i] === '=') { b.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else b.push(s.charCodeAt(i)); } return { out: _dec(b) }; } },
  'hacking-and-ctf-base64url-encoder': { fields: [area('input', 'Text', { default: 'Hello?World' })], run: (v) => ({ out: b64urlEnc(v.input || ''), mono: true }) },
  'hacking-and-ctf-base64url-decoder': { fields: [area('input', 'Base64URL')], run: (v) => { try { return { out: b64urlDec(v.input || '') }; } catch (e) { return { error: 'Invalid Base64URL' }; } } },
  'hacking-and-ctf-morse-code-encoder': { fields: [area('input', 'Text', { default: 'SOS help' })], run: (v) => ({ out: morseEncode(v.input || ''), mono: true }) },
  'hacking-and-ctf-morse-code-decoder': { fields: [area('input', 'Morse code', { default: '... --- ...' })], run: (v) => ({ out: morseDecode(v.input || '') }) },
  'hacking-and-ctf-data-uri-encoder': { fields: [area('input', 'Content'), text('mime', 'MIME type', { default: 'text/plain' })], run: (v) => ({ out: `data:${v.mime || 'text/plain'};base64,${b64enc(v.input || '')}`, mono: true }) },
  'hacking-and-ctf-data-uri-decoder': { fields: [area('input', 'data: URI')], run: (v) => { const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec((v.input || '').trim()); if (!m) return { error: 'Not a data: URI' }; const body = m[2] ? b64dec(m[3]) : decodeURIComponent(m[3]); return { out: `MIME: ${m[1] || 'text/plain'}\nEncoding: ${m[2] ? 'base64' : 'url'}\n\n${body}`, mono: true }; } },

  /* --- classical ciphers --- */
  'hacking-and-ctf-caesar-cipher-encoder': { fields: [area('input', 'Text', { default: 'Attack at dawn' }), nf('shift', 'Shift', { default: 3 })], run: (v) => ({ out: caesarShift(v.input || '', num(v.shift)) }) },
  'hacking-and-ctf-caesar-cipher-decoder': { fields: [area('input', 'Ciphertext', { default: 'Dwwdfn dw gdzq' }), nf('shift', 'Shift', { default: 3 })], run: (v) => ({ out: caesarShift(v.input || '', -num(v.shift)) }) },
  'hacking-and-ctf-caesar-brute-force': { fields: [area('input', 'Ciphertext', { default: 'Dwwdfn dw gdzq' })], run: (v) => { const out = []; for (let i = 1; i < 26; i++) out.push(`[${String(i).padStart(2)}] ${caesarShift(v.input || '', -i)}`); return { out: out.join('\n'), mono: true, note: 'All 25 shifts — the readable line is your plaintext.' }; } },
  'hacking-and-ctf-rot13-converter': { fields: [area('input', 'Text', { default: 'Hello' })], run: (v) => ({ out: caesarShift(v.input || '', 13), note: 'ROT13 is its own inverse — run it again to decode.' }) },
  'hacking-and-ctf-rot47-converter': { fields: [area('input', 'Text', { default: 'Hello World' })], run: (v) => ({ out: rot47(v.input || ''), mono: true, note: 'ROT47 is its own inverse.' }) },
  'hacking-and-ctf-atbash-cipher': { fields: [area('input', 'Text', { default: 'Hello' })], run: (v) => ({ out: atbash(v.input || ''), note: 'Atbash is its own inverse.' }) },
  'hacking-and-ctf-vigenere-encoder': { fields: [area('input', 'Text', { default: 'Attack at dawn' }), text('key', 'Keyword', { default: 'LEMON' })], run: (v) => { try { return { out: vigenere(v.input || '', v.key) }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-vigenere-decoder': { fields: [area('input', 'Ciphertext'), text('key', 'Keyword', { default: 'LEMON' })], run: (v) => { try { return { out: vigenere(v.input || '', v.key, true) }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-rail-fence-encoder': { fields: [area('input', 'Text', { default: 'WEAREDISCOVEREDFLEEATONCE' }), nf('rails', 'Rails', { default: 3 })], run: (v) => ({ out: railFenceEnc(v.input || '', Math.max(2, num(v.rails) || 2)), mono: true }) },
  'hacking-and-ctf-rail-fence-decoder': { fields: [area('input', 'Ciphertext'), nf('rails', 'Rails', { default: 3 })], run: (v) => ({ out: railFenceDec(v.input || '', Math.max(2, num(v.rails) || 2)) }) },
  'hacking-and-ctf-xor-cipher': { fields: [area('input', 'Input'), text('key', 'Key (text)', { default: 'secret' }), sel('mode', 'Mode', ['Encrypt (text → hex)', 'Decrypt (hex → text)'])], run: (v) => { const key = v.key || ''; if (!key) return { error: 'Enter a key' }; if (v.mode && v.mode.startsWith('Decrypt')) { const hex = (v.input || '').replace(/[^0-9a-f]/gi, ''); let o = ''; for (let i = 0; i < hex.length; i += 2) { const b = parseInt(hex.substr(i, 2), 16); o += String.fromCharCode(b ^ key.charCodeAt((i / 2) % key.length)); } return { out: o }; } const t = v.input || ''; let o = ''; for (let i = 0; i < t.length; i++) o += (t.charCodeAt(i) ^ key.charCodeAt(i % key.length)).toString(16).padStart(2, '0'); return { out: o, mono: true }; } },
  'hacking-and-ctf-single-byte-xor-brute-force': { fields: [area('input', 'Ciphertext (hex)', { default: '1b37373331363f78151b7f2b783431333d78397828372d363c78373e783a393b3736' })], run: (v) => { const hex = (v.input || '').replace(/[^0-9a-f]/gi, ''); if (hex.length < 2 || hex.length % 2) return { error: 'Enter ciphertext as hex (even number of digits)' }; const bytes = []; for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16)); const FREQ = { ' ': 13, e: 12.7, t: 9.1, a: 8.2, o: 7.5, i: 7, n: 6.7, s: 6.3, h: 6.1, r: 6, d: 4.3, l: 4, u: 2.8, c: 2.8, m: 2.4, w: 2.4, f: 2.2, g: 2, y: 2, p: 1.9, b: 1.5, v: 1, k: 0.8 }; const results = []; for (let k = 0; k < 256; k++) { let s = '', score = 0; for (const b of bytes) { const c = b ^ k; s += String.fromCharCode(c); const ch = String.fromCharCode(c).toLowerCase(); if (FREQ[ch]) score += FREQ[ch]; else if (c >= 32 && c <= 126) score += 0.3; else if (c === 10 || c === 9) score += 0.1; else score -= 15; } results.push({ k, s, score }); } results.sort((a, b) => b.score - a.score); const top = results.slice(0, 8).map((r) => `key 0x${r.k.toString(16).padStart(2, '0')} ('${/[\x20-\x7e]/.test(String.fromCharCode(r.k)) ? String.fromCharCode(r.k) : '?'}'): ${r.s.replace(/[^\x20-\x7e]/g, '·')}`); return { out: top.join('\n'), mono: true, note: 'Top 8 single-byte keys ranked by English-text likelihood; the best guess is first.' }; } },
  'hacking-and-ctf-bacon-cipher-encoder': { fields: [area('input', 'Text', { default: 'HELLO' })], run: (v) => ({ out: baconEnc(v.input || ''), mono: true, note: 'A=00000 … Z=11111, written as A/B.' }) },
  'hacking-and-ctf-bacon-cipher-decoder': { fields: [area('input', 'Bacon code (A/B)', { default: 'AABBB AABAA ABABB ABABB ABBBA' })], run: (v) => ({ out: baconDec(v.input || '') }) },
  'hacking-and-ctf-a1z26-encoder': { fields: [area('input', 'Text', { default: 'hello world' })], run: (v) => ({ out: a1z26Enc(v.input || ''), mono: true, note: 'A=1 … Z=26, space = /' }) },
  'hacking-and-ctf-a1z26-decoder': { fields: [area('input', 'Numbers', { default: '8 5 12 12 15 / 23 15 18 12 4' })], run: (v) => ({ out: a1z26Dec(v.input || '') }) },
  'hacking-and-ctf-affine-cipher-encoder': { fields: [area('input', 'Text', { default: 'AFFINE CIPHER' }), nf('a', 'a (coprime with 26)', { default: 5 }), nf('b', 'b', { default: 8 })], run: (v) => { const a = num(v.a); if (modInv(a, 26) == null) return { error: 'a must be coprime with 26 (1,3,5,7,9,11,15,17,19,21,23,25)' }; return { out: affineEnc(v.input || '', a, num(v.b)) }; } },
  'hacking-and-ctf-affine-cipher-decoder': { fields: [area('input', 'Ciphertext', { default: 'IHHWVC SWFRCP' }), nf('a', 'a', { default: 5 }), nf('b', 'b', { default: 8 })], run: (v) => { const a = num(v.a); const r = affineDec(v.input || '', a, num(v.b)); if (r == null) return { error: 'a must be coprime with 26' }; return { out: r }; } },
  'hacking-and-ctf-polybius-square-encoder': { fields: [area('input', 'Text', { default: 'HELLO' })], run: (v) => ({ out: polybiusEnc(v.input || ''), mono: true, note: '5×5 grid, I/J share a cell. Row then column (1–5).' }) },
  'hacking-and-ctf-polybius-square-decoder': { fields: [area('input', 'Coordinates', { default: '23 15 31 31 34' })], run: (v) => ({ out: polybiusDec(v.input || '') }) },
  'hacking-and-ctf-substitution-cipher': { fields: [area('input', 'Text', { default: 'HELLO' }), text('key', '26-letter key', { default: 'QWERTYUIOPASDFGHJKLZXCVBNM' })], run: (v) => { const k = (v.key || '').toUpperCase().replace(/[^A-Z]/g, ''); if (k.length !== 26 || new Set(k).size !== 26) return { error: 'Key must be a permutation of all 26 letters' }; return { out: (v.input || '').replace(/[a-z]/gi, (ch) => { const up = ch <= 'Z'; const m = k[ch.toUpperCase().charCodeAt(0) - 65]; return up ? m : m.toLowerCase(); }) }; } },
  'hacking-and-ctf-leetspeak-encoder': { fields: [area('input', 'Text', { default: 'leet hacker' })], run: (v) => ({ out: (v.input || '').toLowerCase().replace(/[a-z]/g, (c) => LEET[c] || c) }) },
  'hacking-and-ctf-leetspeak-decoder': { fields: [area('input', 'Leetspeak', { default: '1337 h4ck3r' })], run: (v) => ({ out: (v.input || '').replace(/[0-9]/g, (c) => LEET_REV[c] || c), note: 'Best-effort — leet is ambiguous.' }) },
  'hacking-and-ctf-nato-phonetic-encoder': { fields: [area('input', 'Text', { default: 'ABC 123' })], run: (v) => ({ out: (v.input || '').toUpperCase().split('').map((ch) => ch === ' ' ? '(space)' : (NATO[ch] || ch)).join(' ') }) },

  /* --- hashing & crypto --- */
  'hacking-and-ctf-md5-hash': { fields: [area('input', 'Text', { default: 'hello' })], run: (v) => ({ out: md5(v.input || ''), mono: true, note: 'MD5 is broken for security — fine for checksums/CTF only.' }) },
  'hacking-and-ctf-sha-1-hash': { fields: [area('input', 'Text', { default: 'hello' })], run: async (v) => ({ out: await digest('SHA-1', v.input || ''), mono: true }) },
  'hacking-and-ctf-sha-256-hash': { fields: [area('input', 'Text', { default: 'hello' })], run: async (v) => ({ out: await digest('SHA-256', v.input || ''), mono: true }) },
  'hacking-and-ctf-sha-512-hash': { fields: [area('input', 'Text', { default: 'hello' })], run: async (v) => ({ out: await digest('SHA-512', v.input || ''), mono: true }) },
  'hacking-and-ctf-hmac-generator': { fields: [area('text', 'Message', { default: 'hello' }), text('key', 'Secret key', { default: 'secret' }), sel('algo', 'Algorithm', ['SHA-256', 'SHA-1', 'SHA-512'])], run: async (v) => { const key = await crypto.subtle.importKey('raw', _enc(v.key || ''), { name: 'HMAC', hash: v.algo || 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, _enc(v.text || '')); return { out: Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join(''), mono: true }; } },
  'hacking-and-ctf-crc32-checksum': { fields: [area('input', 'Text', { default: 'hello' })], run: (v) => { const n = crc32(v.input || ''); return { out: `0x${n.toString(16).padStart(8, '0')}  (${n})`, mono: true }; } },
  'hacking-and-ctf-adler-32-checksum': { fields: [area('input', 'Text', { default: 'hello' })], run: (v) => { const n = adler32(v.input || ''); return { out: `0x${n.toString(16).padStart(8, '0')}  (${n})`, mono: true }; } },
  'hacking-and-ctf-hash-identifier': { fields: [text('hash', 'Hash string', { default: '5d41402abc4b2a76b9719d911017c592' })], run: (v) => { const h = (v.hash || '').trim(); const g = []; if (/^[a-f0-9]{32}$/i.test(h)) g.push('MD5', 'MD4', 'NTLM'); if (/^[a-f0-9]{40}$/i.test(h)) g.push('SHA-1', 'RIPEMD-160'); if (/^[a-f0-9]{56}$/i.test(h)) g.push('SHA-224', 'SHA3-224'); if (/^[a-f0-9]{64}$/i.test(h)) g.push('SHA-256', 'SHA3-256', 'BLAKE2s'); if (/^[a-f0-9]{96}$/i.test(h)) g.push('SHA-384', 'SHA3-384'); if (/^[a-f0-9]{128}$/i.test(h)) g.push('SHA-512', 'SHA3-512', 'BLAKE2b', 'Whirlpool'); if (/^\$2[aby]\$\d{2}\$/.test(h)) g.push('bcrypt'); if (/^\$1\$/.test(h)) g.push('md5crypt'); if (/^\$5\$/.test(h)) g.push('sha256crypt'); if (/^\$6\$/.test(h)) g.push('sha512crypt'); if (/^\$argon2/.test(h)) g.push('Argon2'); if (/^[a-f0-9]{8}$/i.test(h)) g.push('CRC32', 'Adler-32'); if (!g.length) return { out: `No confident match (length ${h.length}).`, note: 'Check the character set and any prefix.' }; return { out: g.join('\n'), note: `${h.length} chars`, mono: true }; } },
  'hacking-and-ctf-password-entropy-calculator': { fields: [text('password', 'Password', { default: 'Tr0ub4dour&3' })], run: (v) => { const p = v.password || ''; if (!p) return { error: 'Enter a password' }; let pool = 0; if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/[0-9]/.test(p)) pool += 10; if (/[^a-zA-Z0-9]/.test(p)) pool += 33; const bits = p.length * Math.log2(pool || 1); const s = bits < 28 ? 'Very weak' : bits < 36 ? 'Weak' : bits < 60 ? 'Reasonable' : bits < 128 ? 'Strong' : 'Very strong'; return { out: `Length: ${p.length}\nCharset pool: ${pool}\nEntropy: ${bits.toFixed(1)} bits\nStrength: ${s}`, mono: true, note: 'Assumes random choice from the pool; real passwords are usually weaker.' }; } },
  'hacking-and-ctf-random-bytes-generator': { fields: [nf('bytes', 'Bytes', { default: 16 }), sel('fmt', 'Format', ['hex', 'base64', 'decimal array'])], run: (v) => { const n = Math.min(1024, Math.max(1, num(v.bytes) || 16)); const a = crypto.getRandomValues(new Uint8Array(n)); let out; if (v.fmt === 'base64') out = btoa(String.fromCharCode(...a)); else if (v.fmt === 'decimal array') out = '[' + Array.from(a).join(', ') + ']'; else out = Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join(''); return { out, mono: true, note: `${n} cryptographically-random bytes` }; } },

  /* --- JWT --- */
  'hacking-and-ctf-jwt-signature-verifier': { fields: [area('token', 'JWT', { rows: 4 }), text('secret', 'HS256 secret')], run: async (v) => { const parts = (v.token || '').trim().split('.'); if (parts.length !== 3) return { error: 'JWT must have 3 dot-separated parts' }; let header = {}, payload = {}; try { header = JSON.parse(b64urlDec(parts[0])); payload = JSON.parse(b64urlDec(parts[1])); } catch { return { error: 'Could not decode JWT header/payload' }; } const key = await crypto.subtle.importKey('raw', _enc(v.secret || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, _enc(parts[0] + '.' + parts[1])); const b64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const ok = b64 === parts[2]; return { out: `Signature: ${ok ? '✓ VALID' : '✗ INVALID'} (HS256)\n\nHeader: ${JSON.stringify(header)}\nPayload: ${JSON.stringify(payload, null, 2)}`, mono: true, note: header.alg && header.alg !== 'HS256' ? `Token alg is ${header.alg}; this verifies HS256 only.` : undefined }; } },
  'hacking-and-ctf-jwt-claims-inspector': { fields: [area('token', 'JWT', { rows: 4 })], run: (v) => { const parts = (v.token || '').trim().split('.'); if (parts.length < 2) return { error: 'Not a JWT' }; let h, p; try { h = JSON.parse(b64urlDec(parts[0])); p = JSON.parse(b64urlDec(parts[1])); } catch { return { error: 'Could not decode JWT' }; } const now = Math.floor(Date.now() / 1000); const lines = [`alg: ${h.alg}   typ: ${h.typ || '-'}`, '']; for (const k in p) { let val = p[k]; if (['exp', 'iat', 'nbf'].includes(k) && typeof val === 'number') { const d = new Date(val * 1000).toISOString(); const rel = k === 'exp' ? (val < now ? ' EXPIRED' : ' valid') : ''; val = `${p[k]} (${d})${rel}`; } lines.push(`${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`); } if (typeof p.exp === 'number') lines.push('', p.exp < now ? `⚠ Expired ${Math.floor((now - p.exp) / 60)} min ago` : `Expires in ${Math.floor((p.exp - now) / 60)} min`); return { out: lines.join('\n'), mono: true }; } },

  /* --- analysis / forensics --- */
  'hacking-and-ctf-character-frequency-analyzer': { fields: [area('input', 'Text', { default: 'the quick brown fox' })], run: (v) => { const s = v.input || ''; const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1; const sorted = Object.entries(f).sort((a, b) => b[1] - a[1]); const out = sorted.slice(0, 40).map(([c, n]) => `${JSON.stringify(c).padEnd(6)} ${String(n).padStart(5)}  ${(n / s.length * 100).toFixed(1)}%`).join('\n'); return { out, mono: true, note: `${s.length} chars, ${sorted.length} distinct` }; } },
  'hacking-and-ctf-index-of-coincidence-calculator': { fields: [area('input', 'Text', { default: 'LXFOPVEFRNHR' })], run: (v) => { const ioc = indexOfCoincidence(v.input || ''); return { out: `Index of Coincidence: ${ioc.toFixed(4)}`, note: 'English ≈ 0.0667 (monoalphabetic). Random/polyalphabetic ≈ 0.0385. Low IoC suggests Vigenère.' }; } },
  'hacking-and-ctf-shannon-entropy-calculator': { fields: [area('input', 'Text', { default: 'password123' })], run: (v) => { const s = v.input || ''; if (!s) return { error: 'Enter text' }; const h = shannon(s); return { out: `Entropy: ${h.toFixed(4)} bits/char\nTotal: ${(h * s.length).toFixed(1)} bits over ${s.length} chars`, mono: true, note: 'Encrypted/compressed data ≈ 7.9+ bits/char.' }; } },
  'hacking-and-ctf-hex-dump-viewer': { fields: [area('input', 'Text', { default: 'Hello, world!' })], run: (v) => { const b = _enc(v.input || ''); const lines = []; for (let i = 0; i < b.length; i += 16) { const slice = b.slice(i, i + 16); const hex = Array.from(slice).map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47); const ascii = Array.from(slice).map((x) => x >= 32 && x <= 126 ? String.fromCharCode(x) : '.').join(''); lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`); } return { out: lines.join('\n') || '(empty)', mono: true }; } },
  'hacking-and-ctf-hex-dump-reverser': { fields: [area('input', 'Hex dump')], run: (v) => { const out = []; for (const line of (v.input || '').split('\n')) { let s = line.replace(/\|.*$/, '').replace(/^\s*[0-9a-fA-F]+:?\s/, ''); const pairs = s.match(/[0-9a-fA-F]{2}/g) || []; for (const p of pairs) out.push(parseInt(p, 16)); } return { out: _dec(out) || '(nothing parsed)' }; } },
  'hacking-and-ctf-string-extractor': { fields: [area('input', 'Data (hex or raw)'), nf('min', 'Min length', { default: 4 })], run: (v) => { const compact = (v.input || '').replace(/\s/g, ''); let bytes; if (/^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0) { bytes = []; for (let i = 0; i < compact.length; i += 2) bytes.push(parseInt(compact.substr(i, 2), 16)); } else bytes = Array.from(_enc(v.input || '')); const min = Math.max(1, num(v.min) || 4); const strs = []; let cur = ''; for (const b of bytes) { if (b >= 32 && b <= 126) cur += String.fromCharCode(b); else { if (cur.length >= min) strs.push(cur); cur = ''; } } if (cur.length >= min) strs.push(cur); return { out: strs.join('\n') || '(no strings found)', mono: true, note: `${strs.length} strings (min length ${min})` }; } },
  'hacking-and-ctf-encoding-detector': { fields: [area('input', 'Unknown text')], run: (v) => { const s = (v.input || '').trim(); if (!s) return { error: 'Enter text' }; const notes = []; if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) notes.push('• Looks like Base64'); if (/^[A-Z2-7]+=*$/.test(s) && s.length % 8 === 0) notes.push('• Looks like Base32'); if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) notes.push('• Looks like Hex'); if (/^[01\s]+$/.test(s)) notes.push('• Looks like Binary'); if (/^[.\-\s/]+$/.test(s)) notes.push('• Looks like Morse code'); if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s) && s.length > 4) notes.push('• Could be Base58'); if (/^\s*[{[]/.test(s)) notes.push('• Looks like JSON'); if (/%[0-9a-f]{2}/i.test(s)) notes.push('• Contains URL-encoding'); if (/&[a-z]+;|&#\d+;/i.test(s)) notes.push('• Contains HTML entities'); notes.push('', `Shannon entropy: ${shannon(s).toFixed(2)} bits/char`); return { out: notes.join('\n'), mono: true }; } },
  'hacking-and-ctf-ascii-table-reference': { fields: [], run: () => { const lines = []; for (let i = 32; i <= 126; i++) lines.push(`${String(i).padStart(3)}  0x${i.toString(16).padStart(2, '0')}  ${String.fromCharCode(i)}`); return { out: lines.join('\n'), mono: true, note: 'Printable ASCII 32–126' }; } },
  'hacking-and-ctf-regex-escaper': { fields: [area('input', 'Text to escape', { default: 'a.b+c (1.00)' })], run: (v) => ({ out: (v.input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), mono: true, note: 'Safe to drop into a regex literal.' }) },

  /* --- web security --- */
  'hacking-and-ctf-security-headers-analyzer': { fields: [area('headers', 'Paste HTTP response headers', { default: 'content-type: text/html\nx-frame-options: DENY\nx-powered-by: Express' })], run: (v) => { const h = {}; for (const line of (v.headers || '').split('\n')) { const m = /^([^:]+):(.*)$/.exec(line); if (m) h[m[1].trim().toLowerCase()] = m[2].trim(); } const checks = [['strict-transport-security', 'HSTS — forces HTTPS'], ['content-security-policy', 'CSP — limits script/resource origins'], ['x-frame-options', 'Clickjacking protection'], ['x-content-type-options', 'MIME-sniffing protection'], ['referrer-policy', 'Controls Referer leakage'], ['permissions-policy', 'Restricts browser features']]; const out = checks.map(([k, d]) => h[k] ? `✓ ${k}: ${h[k]}` : `✗ ${k} MISSING — ${d}`); if (h['server']) out.push(`ℹ server: ${h['server']} (consider hiding the version)`); if (h['x-powered-by']) out.push(`⚠ x-powered-by: ${h['x-powered-by']} (leaks stack — remove it)`); return { out: out.join('\n'), mono: true }; } },
  'hacking-and-ctf-csp-analyzer': { fields: [area('csp', 'Content-Security-Policy value', { default: "default-src 'self'; script-src 'self' 'unsafe-inline' *" })], run: (v) => { const dirs = (v.csp || '').split(';').map((x) => x.trim()).filter(Boolean); const out = [], warn = []; for (const d of dirs) { const [name, ...vals] = d.split(/\s+/); out.push(`${name}: ${vals.join(' ') || '(empty)'}`); if (vals.includes("'unsafe-inline'")) warn.push(`⚠ ${name} allows 'unsafe-inline' (XSS risk)`); if (vals.includes("'unsafe-eval'")) warn.push(`⚠ ${name} allows 'unsafe-eval'`); if (vals.includes('*')) warn.push(`⚠ ${name} allows * (any origin)`); } if (!dirs.some((d) => /^default-src/.test(d))) warn.push('⚠ No default-src fallback directive'); return { out: out.join('\n') + (warn.length ? '\n\n' + warn.join('\n') : '\n\nNo obvious weaknesses found.'), mono: true }; } },
  'hacking-and-ctf-cookie-flag-analyzer': { fields: [area('cookie', 'Set-Cookie header value', { default: 'session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax' })], run: (v) => { const s = v.cookie || ''; const low = s.toLowerCase(); const name = ((/^([^=]+)=/.exec(s.trim()) || [])[1] || '(unknown)').trim(); const out = [`Cookie: ${name}`]; out.push(low.includes('httponly') ? '✓ HttpOnly — not readable by JS' : '✗ HttpOnly MISSING — JS/XSS can read it'); out.push(low.includes('secure') ? '✓ Secure — HTTPS only' : '✗ Secure MISSING — also sent over HTTP'); const ss = /samesite=(\w+)/i.exec(s); out.push(ss ? `✓ SameSite=${ss[1]}` : '✗ SameSite MISSING — CSRF risk'); out.push(/expires=|max-age=/i.test(s) ? 'ℹ Persistent cookie' : 'ℹ Session cookie'); return { out: out.join('\n'), mono: true }; } },
  'hacking-and-ctf-http-status-lookup': { fields: [text('code', 'Status code', { default: '404' })], run: (v) => { const c = parseInt(v.code, 10); const name = HTTP_STATUS[c]; if (!name) return { error: 'Unknown status code' }; const cls = { 1: 'Informational', 2: 'Success', 3: 'Redirection', 4: 'Client Error', 5: 'Server Error' }[String(c)[0]]; return { out: `${c} ${name}\nClass: ${cls}` }; } },
  'hacking-and-ctf-common-ports-lookup': { fields: [text('port', 'Port number (blank = full list)')], run: (v) => { if (!v.port || !v.port.trim()) return { out: Object.entries(PORTS).map(([p, s]) => `${p.padStart(5)}  ${s}`).join('\n'), mono: true, note: 'Common well-known ports' }; const p = parseInt(v.port, 10); return { out: PORTS[p] ? `${p} → ${PORTS[p]}` : `Port ${p}: not in the common-ports list` }; } },
  'hacking-and-ctf-user-agent-parser': { fields: [area('ua', 'User-Agent string', { default: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })], run: (v) => { const ua = v.ua || ''; const os = /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows NT/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown'; let browser = 'Unknown'; let m; if (/Edg\/([\d.]+)/.test(ua)) browser = 'Edge ' + RegExp.$1; else if (/OPR\/([\d.]+)/.test(ua)) browser = 'Opera ' + RegExp.$1; else if ((m = /Chrome\/([\d.]+)/.exec(ua))) browser = 'Chrome ' + m[1]; else if ((m = /Firefox\/([\d.]+)/.exec(ua))) browser = 'Firefox ' + m[1]; else if ((m = /Version\/([\d.]+).*Safari/.exec(ua))) browser = 'Safari ' + m[1]; const type = /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : 'Desktop'; const bot = /bot|crawl|spider|slurp/i.test(ua) ? '\n⚠ Looks like a bot/crawler' : ''; return { out: `OS: ${os}\nBrowser: ${browser}\nType: ${type}${bot}`, mono: true }; } },
  'hacking-and-ctf-url-parser': { fields: [text('url', 'URL', { default: 'https://user:pass@example.com:8443/path/page?q=1&lang=en#top' })], run: (v) => { let u; try { u = new URL(v.url); } catch { return { error: 'Invalid URL' }; } const params = [...u.searchParams.entries()].map(([k, val]) => `    ${k} = ${val}`).join('\n'); return { out: `Protocol: ${u.protocol}\nHost: ${u.hostname}\nPort: ${u.port || '(default)'}\nPath: ${u.pathname}\nQuery:\n${params || '    (none)'}\nFragment: ${u.hash || '(none)'}\nUser: ${u.username || '(none)'}`, mono: true }; } },
  'hacking-and-ctf-html-js-escaper': { fields: [area('input', 'Text'), sel('ctx', 'Insert context', ['HTML body', 'JavaScript string', 'URL component'])], run: (v) => { const s = v.input || ''; let out; if (v.ctx === 'URL component') out = encodeURIComponent(s); else if (v.ctx === 'JavaScript string') out = s.replace(/[\\'"<>\/\r\n\u2028\u2029]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '"': '\\"', '<': '\\x3c', '>': '\\x3e', '/': '\\/', '\r': '\\r', '\n': '\\n', '\u2028': '\\u2028', '\u2029': '\\u2029' }[c])); else out = s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); return { out, mono: true, note: 'Encode for the exact context where the value lands — this prevents XSS.' }; } },

  /* --- network math --- */
  'hacking-and-ctf-ip-to-integer': { fields: [text('ip', 'IPv4 address', { default: '192.168.1.1' })], run: (v) => { try { const n = ipToInt(v.ip); return { out: `Decimal: ${n}\nHex: 0x${n.toString(16).padStart(8, '0')}`, mono: true }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-integer-to-ip': { fields: [text('n', 'Integer or 0x-hex', { default: '3232235777' })], run: (v) => { const s = (v.n || '').trim(); const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10); if (!Number.isFinite(n) || n < 0 || n > 4294967295) return { error: 'Enter a value 0–4294967295' }; return { out: intToIp(n) }; } },
  'hacking-and-ctf-ip-to-binary': { fields: [text('ip', 'IPv4 address', { default: '192.168.1.1' })], run: (v) => { const p = (v.ip || '').trim().split('.'); if (p.length !== 4 || p.some((o) => !/^\d+$/.test(o) || +o > 255)) return { error: 'Invalid IPv4 address' }; return { out: p.map((o) => (+o).toString(2).padStart(8, '0')).join('.'), mono: true }; } },
  'hacking-and-ctf-ipv6-expander': { fields: [text('ip', 'IPv6 address', { default: '2001:db8::1' })], run: (v) => { try { return { out: ipv6Expand(v.ip || ''), mono: true }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-ipv6-compressor': { fields: [text('ip', 'IPv6 address', { default: '2001:0db8:0000:0000:0000:0000:0000:0001' })], run: (v) => { try { return { out: ipv6Compress(v.ip || ''), mono: true }; } catch (e) { return { error: e.message }; } } },
  'hacking-and-ctf-mac-address-formatter': { fields: [text('mac', 'MAC address', { default: '001122AABBCC' }), sel('fmt', 'Format', ['colon (aa:bb)', 'hyphen (aa-bb)', 'dot (aabb.ccdd)', 'bare'])], run: (v) => { const h = (v.mac || '').replace(/[^0-9a-f]/gi, '').toLowerCase(); if (h.length !== 12) return { error: 'MAC must be 12 hex digits' }; const pairs = h.match(/.{2}/g); let out; if (v.fmt && v.fmt.startsWith('hyphen')) out = pairs.join('-'); else if (v.fmt && v.fmt.startsWith('dot')) out = h.match(/.{4}/g).join('.'); else if (v.fmt && v.fmt.startsWith('bare')) out = h; else out = pairs.join(':'); return { out, mono: true }; } },
  'hacking-and-ctf-subnet-mask-converter': { fields: [text('in', 'CIDR (/24) or mask', { default: '/24' })], run: (v) => { const s = (v.in || '').trim(); let bits; if (/^\/?\d{1,2}$/.test(s)) { bits = parseInt(s.replace('/', ''), 10); if (bits > 32) return { error: 'CIDR must be 0–32' }; } else { try { const n = ipToInt(s); bits = n === 0 ? 0 : n.toString(2).replace(/0+$/, '').length; const check = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0); if (check !== n) return { error: 'Not a valid contiguous subnet mask' }; } catch { return { error: 'Enter /24 or 255.255.255.0' }; } } const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0); const hosts = bits >= 31 ? (bits === 32 ? 1 : 2) : (2 ** (32 - bits) - 2); return { out: `CIDR: /${bits}\nMask: ${intToIp(mask)}\nWildcard: ${intToIp((~mask) >>> 0)}\nUsable hosts: ${hosts.toLocaleString('en-IN')}`, mono: true }; } },
};

/* ---------- exports ---------- */
export const MINI_TOOL_SLUGS = new Set(Object.keys(SPECS));
export const miniToolBySlug = (slug) => SPECS[slug] || null;
export const MINI_TOOL_COUNT = MINI_TOOL_SLUGS.size;
