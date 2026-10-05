// Asset Downloader: finds a page's images, styles, scripts, fonts, icons and
// media (server side), and builds the zip of the ones the user picked.
import path from 'node:path';
import * as cheerio from 'cheerio';
import { HttpError, safeFetch, readTextLimited, withTimeout } from '@/lib/toolsServer';
import { parseHttpUrl } from '@/lib/downloader/netguard';
import { runPool } from '@/lib/downloader/pool';

export const ASSET_TYPES = ['image', 'css', 'js', 'font', 'icon', 'media', 'document', 'other'];
export const TYPE_FOLDERS = {
  image: 'images', css: 'css', js: 'js', font: 'fonts', icon: 'icons', media: 'media', document: 'other', other: 'other',
};

export const SCAN_LIMITS = {
  pageBytes: 5 * 1024 * 1024,
  pageTimeoutMs: 15000,
  maxStylesheets: 20,
  cssBytes: 2 * 1024 * 1024,
  cssPhaseMs: 15000,
  manifestBytes: 256 * 1024,
  maxAssets: 1000,
};
export const ZIP_LIMITS = {
  maxFiles: 300,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  concurrency: 4,
  fileTimeoutMs: 20000,
};

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg', '.ico', '.tif', '.tiff', '.heic', '.jxl', '.apng']);
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const MEDIA_EXTS = new Set(['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.opus', '.vtt', '.m3u8']);
const DOC_EXTS = new Set(['.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.rtf', '.odt', '.ods', '.odp', '.epub', '.rar', '.7z', '.gz', '.tgz', '.dmg', '.exe', '.msi', '.apk']);

export const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/pjpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico', 'image/tiff': '.tiff', 'image/heic': '.heic', 'image/jxl': '.jxl', 'image/apng': '.png',
  'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js', 'application/x-javascript': '.js',
  'application/json': '.json', 'application/manifest+json': '.webmanifest', 'text/html': '.html', 'text/plain': '.txt',
  'application/xml': '.xml', 'text/xml': '.xml', 'text/vtt': '.vtt',
  'font/woff': '.woff', 'font/woff2': '.woff2', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/font-woff': '.woff',
  'application/font-woff2': '.woff2', 'application/x-font-woff': '.woff', 'application/x-font-ttf': '.ttf',
  'application/x-font-otf': '.otf', 'application/vnd.ms-fontobject': '.eot', 'font/sfnt': '.ttf',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/webm': '.webm', 'audio/aac': '.aac',
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
};
// Extensions that belong to the same kind of file (so ".jpeg" isn't "fixed" to ".jpg").
const EXT_ALIASES = { '.jpeg': '.jpg', '.jpe': '.jpg', '.tif': '.tiff', '.mjs': '.js', '.htm': '.html' };

const KNOWN_EXTS = new Set([...IMAGE_EXTS, ...FONT_EXTS, ...MEDIA_EXTS, ...DOC_EXTS, ...Object.values(MIME_EXT), '.mjs', '.map', '.htm']);

const extOf = (pathname) => {
  try {
    return path.extname(decodeURIComponent(pathname)).toLowerCase();
  } catch {
    return path.extname(pathname).toLowerCase();
  }
};

function typeFromExt(url, fallback) {
  const ext = extOf(url.pathname);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (FONT_EXTS.has(ext)) return 'font';
  if (MEDIA_EXTS.has(ext)) return 'media';
  if (ext === '.css') return 'css';
  if (ext === '.js' || ext === '.mjs') return 'js';
  return fallback;
}

// File name shown in the list (and the start of the zip entry name).
export function guessFileName(href) {
  try {
    const url = new URL(href);
    let base = path.posix.basename(url.pathname);
    try {
      base = decodeURIComponent(base);
    } catch {}
    return base || url.hostname;
  } catch {
    return 'file';
  }
}

function parseSrcset(srcset) {
  const urls = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
    if (i >= srcset.length) break;
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      while (i < srcset.length && srcset[i] !== ',') i++;
    }
    if (url) urls.push(url);
  }
  return urls;
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)'"]+))/gi;
const FONT_FACE = /@font-face\s*\{[^}]*\}/gi;
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// url(...) references and @imports of a stylesheet. Fonts are recognised by
// extension or by sitting inside an @font-face block.
export function parseCss(css) {
  const clean = stripComments(css);
  const fontRefs = new Set();
  for (const block of clean.match(FONT_FACE) || []) {
    for (const m of block.matchAll(CSS_URL)) fontRefs.add((m[1] ?? m[2] ?? m[3]).trim());
  }
  const imports = [];
  for (const m of clean.matchAll(CSS_IMPORT)) imports.push((m[1] ?? m[2] ?? m[3]).trim());
  const urls = [];
  for (const m of clean.matchAll(CSS_URL)) {
    const ref = (m[1] ?? m[2] ?? m[3]).trim();
    if (imports.includes(ref)) continue;
    urls.push({ ref, font: fontRefs.has(ref) });
  }
  return { urls, imports };
}

class AssetList {
  constructor(max) {
    this.max = max;
    this.map = new Map();
    this.dropped = 0;
  }

  // Returns the absolute URL string when it was valid (added or already known).
  add(raw, base, type, source) {
    const value = String(raw ?? '').trim();
    if (!value || value.startsWith('#') || /^(data|blob|javascript|about|mailto|tel):/i.test(value)) return null;
    let url;
    try {
      url = new URL(value, base);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    const href = url.href;
    if (this.map.has(href)) return href;
    if (this.map.size >= this.max) {
      this.dropped++;
      return null;
    }
    const finalType = typeof type === 'function' ? type(url) : type;
    this.map.set(href, { url: href, type: finalType, source, name: guessFileName(href) });
    return href;
  }

  get values() {
    return [...this.map.values()];
  }
}

async function fetchText(url, { signal, maxBytes, accept }) {
  const { res, finalUrl } = await safeFetch(url, { signal, headers: { Accept: accept, 'User-Agent': BROWSER_UA } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  return { text: await readTextLimited(res, maxBytes), finalUrl, contentType: type };
}

function extractFromHtml($, base, list, { includeDocuments }) {
  const attr = (el, name) => $(el).attr(name);
  const img = (url) => typeFromExt(url, 'image');

  $('img').each((_, el) => {
    list.add(attr(el, 'src'), base, img, 'img src');
    for (const a of ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-full-src']) {
      list.add(attr(el, a), base, img, `img ${a}`);
    }
    for (const a of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
      for (const u of parseSrcset(attr(el, a) || '')) list.add(u, base, img, `img ${a}`);
    }
  });
  $('source').each((_, el) => {
    const parent = el.parent?.name;
    if (parent === 'video' || parent === 'audio') {
      list.add(attr(el, 'src'), base, 'media', `${parent} source`);
      return;
    }
    for (const a of ['srcset', 'data-srcset']) {
      for (const u of parseSrcset(attr(el, a) || '')) list.add(u, base, img, 'picture source');
    }
  });
  $('[data-bg], [data-background], [data-background-image], [data-bg-src]').each((_, el) => {
    for (const a of ['data-bg', 'data-background', 'data-background-image', 'data-bg-src']) {
      const v = attr(el, a);
      if (!v) continue;
      const m = [...v.matchAll(CSS_URL)];
      if (m.length) for (const x of m) list.add(x[1] ?? x[2] ?? x[3], base, img, a);
      else list.add(v, base, img, a);
    }
  });
  $('[style*="url("]').each((_, el) => {
    for (const m of (attr(el, 'style') || '').matchAll(CSS_URL)) {
      list.add(m[1] ?? m[2] ?? m[3], base, (u) => typeFromExt(u, 'image'), 'inline style');
    }
  });
  $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"], meta[name="msapplication-TileImage"]').each((_, el) => {
    const key = attr(el, 'property') || attr(el, 'name') || attr(el, 'itemprop');
    list.add(attr(el, 'content'), base, key === 'msapplication-TileImage' ? 'icon' : 'image', `meta ${key}`);
  });
  $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"]').each((_, el) => {
    list.add(attr(el, 'content'), base, 'media', `meta ${attr(el, 'property')}`);
  });
  $('image, use').each((_, el) => {
    const href = attr(el, 'href') || attr(el, 'xlink:href');
    if (href && !href.startsWith('#')) list.add(href.split('#')[0], base, img, `svg <${el.name}>`);
  });

  $('link[href]').each((_, el) => {
    const rel = (attr(el, 'rel') || '').toLowerCase().split(/\s+/);
    const href = attr(el, 'href');
    if (rel.includes('stylesheet')) list.add(href, base, 'css', 'link stylesheet');
    else if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') || rel.includes('mask-icon')) {
      list.add(href, base, 'icon', `link ${rel.join(' ')}`);
    } else if (rel.includes('manifest')) list.add(href, base, 'other', 'link manifest');
    else if (rel.includes('modulepreload')) list.add(href, base, 'js', 'link modulepreload');
    else if (rel.includes('preload') || rel.includes('prefetch')) {
      const as = (attr(el, 'as') || '').toLowerCase();
      const byAs = { style: 'css', script: 'js', font: 'font', image: 'image', video: 'media', audio: 'media' }[as];
      if (byAs) list.add(href, base, byAs, `link ${rel.includes('preload') ? 'preload' : 'prefetch'}`);
    } else if (rel.includes('image_src')) list.add(href, base, 'image', 'link image_src');
  });
  $('script[src]').each((_, el) => list.add(attr(el, 'src'), base, 'js', 'script'));

  $('video, audio').each((_, el) => {
    list.add(attr(el, 'src'), base, 'media', el.name);
    list.add(attr(el, 'data-src'), base, 'media', `${el.name} data-src`);
    if (el.name === 'video') list.add(attr(el, 'poster'), base, 'image', 'video poster');
  });
  $('track[src]').each((_, el) => list.add(attr(el, 'src'), base, 'media', 'track'));
  $('embed[src], object[data]').each((_, el) => {
    list.add(attr(el, 'src') || attr(el, 'data'), base, (u) => typeFromExt(u, 'other'), el.name);
  });

  if (includeDocuments) {
    $('a[href]').each((_, el) => {
      const href = attr(el, 'href');
      let url;
      try {
        url = new URL(href, base);
      } catch {
        return;
      }
      if (DOC_EXTS.has(extOf(url.pathname))) list.add(href, base, 'document', 'link');
    });
  }
}

function addCssRefs(css, cssUrl, list, source) {
  const { urls, imports } = parseCss(css);
  for (const { ref, font } of urls) {
    list.add(ref, cssUrl, font ? (u) => typeFromExt(u, 'font') : (u) => typeFromExt(u, 'image'), source);
  }
  return imports;
}

export async function scanAssets(rawUrl, { signal, includeDocuments = false } = {}) {
  const pageUrl = parseHttpUrl(rawUrl);
  let page;
  try {
    const { res, finalUrl } = await safeFetch(pageUrl, {
      signal: withTimeout(signal, SCAN_LIMITS.pageTimeoutMs),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'User-Agent': BROWSER_UA },
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(502, 'PAGE_HTTP_ERROR', `The page answered with HTTP ${res.status}.`);
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('html') && !contentType.includes('xml')) {
      await res.body?.cancel();
      throw new HttpError(415, 'NOT_HTML', `That URL is a "${contentType.split(';')[0]}" file, not a web page.`);
    }
    try {
      page = { html: await readTextLimited(res, SCAN_LIMITS.pageBytes), finalUrl };
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw new HttpError(413, 'PAGE_TOO_LARGE', 'The page is larger than 5 MB.');
      throw err;
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new HttpError(504, 'TIMEOUT', 'The page took too long to answer.');
    throw new HttpError(502, 'FETCH_FAILED', `Could not fetch the page: ${err.cause?.message || err.message}`);
  }

  const $ = cheerio.load(page.html);
  let base;
  try {
    base = new URL($('base[href]').attr('href') ?? page.finalUrl, page.finalUrl);
  } catch {
    base = new URL(page.finalUrl);
  }
  const list = new AssetList(SCAN_LIMITS.maxAssets);
  extractFromHtml($, base, list, { includeDocuments });
  $('style').each((_, el) => addCssRefs($(el).text(), base, list, 'style block'));

  // Linked stylesheets (and one level of their @imports) — fetched to find fonts and backgrounds.
  const warnings = [];
  const phase = withTimeout(signal, SCAN_LIMITS.cssPhaseMs);
  const fetched = new Set();
  let queue = list.values.filter((a) => a.type === 'css').map((a) => ({ url: a.url, depth: 0 }));
  let cssScanned = 0;
  while (queue.length && fetched.size < SCAN_LIMITS.maxStylesheets && !phase.aborted) {
    const batch = queue.filter((q) => !fetched.has(q.url)).slice(0, SCAN_LIMITS.maxStylesheets - fetched.size);
    queue = [];
    batch.forEach((q) => fetched.add(q.url));
    await runPool(batch, 5, async ({ url, depth }) => {
      try {
        const { text, finalUrl } = await fetchText(url, { signal: withTimeout(phase, 10000), maxBytes: SCAN_LIMITS.cssBytes, accept: 'text/css,*/*;q=0.1' });
        cssScanned++;
        const imports = addCssRefs(text, finalUrl, list, `css ${guessFileName(url)}`);
        for (const ref of imports) {
          const href = list.add(ref, finalUrl, 'css', `@import in ${guessFileName(url)}`);
          if (href && depth === 0) queue.push({ url: href, depth: 1 });
        }
      } catch (err) {
        warnings.push(`Couldn't read stylesheet ${guessFileName(url)}: ${err.status === 413 ? 'larger than 2 MB' : err.message}`);
      }
    }, phase);
  }
  const cssTotal = list.values.filter((a) => a.type === 'css').length;
  if (cssTotal > fetched.size) warnings.push(`Only the first ${fetched.size} of ${cssTotal} stylesheets were scanned for fonts and images.`);

  // The web app manifest's icons (one small JSON file).
  const manifest = list.values.find((a) => a.source === 'link manifest');
  if (manifest && !phase.aborted) {
    try {
      const { text, finalUrl } = await fetchText(manifest.url, { signal: withTimeout(signal, 8000), maxBytes: SCAN_LIMITS.manifestBytes, accept: 'application/manifest+json,application/json,*/*;q=0.1' });
      const json = JSON.parse(text);
      for (const icon of Array.isArray(json.icons) ? json.icons.slice(0, 50) : []) {
        if (typeof icon?.src === 'string') list.add(icon.src, finalUrl, 'icon', 'manifest icon');
      }
    } catch {
      warnings.push('Couldn’t read the web app manifest.');
    }
  }

  return {
    url: pageUrl.href,
    finalUrl: page.finalUrl,
    title: $('title').first().text().trim().slice(0, 300) || null,
    cssScanned,
    truncated: list.dropped > 0,
    warnings,
    assets: list.values,
  };
}

// ---------------- Zip ----------------

async function readBytesLimited(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const safeStem = (s) =>
  s.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/\.{2,}/g, '.').replace(/^[.\-_]+/, '').slice(0, 90);

// A safe "folder/name.ext" for an asset: no slashes, no "..", no hidden
// files, and an extension that matches what the server said it is.
export function entryName(href, type, contentType, used) {
  const folder = TYPE_FOLDERS[type] || 'other';
  let base = guessFileName(href);
  let ext = path.extname(base).toLowerCase();
  let stem = safeStem(ext ? base.slice(0, -ext.length) : base);
  ext = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  const wanted = MIME_EXT[mime];
  // Trust a specific content-type over the URL (e.g. a CDN serving photo.jpg as WebP);
  // generic ones like text/plain or octet-stream keep the URL's extension.
  if (wanted && (EXT_ALIASES[ext] || ext) !== (EXT_ALIASES[wanted] || wanted)) {
    const sameFamily = [FONT_EXTS, MEDIA_EXTS].some((set) => set.has(ext) && set.has(wanted));
    const generic = (mime === 'text/plain' || mime === 'text/html') && KNOWN_EXTS.has(ext);
    if (!ext || !(sameFamily || generic)) ext = wanted;
  }
  if (!stem) stem = type === 'other' ? 'file' : type;
  let name = `${folder}/${stem}${ext}`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${folder}/${stem}-${i}${ext}`;
  used.add(name.toLowerCase());
  return name;
}

const COMPRESSED = /^(image\/(?!svg)|font\/woff|application\/(font-woff|x-font-woff|zip|gzip|x-7z|x-rar|pdf|vnd\.openxmlformats|epub)|video\/|audio\/)/;
const COMPRESSED_EXT = /\.(jpe?g|png|gif|webp|avif|ico|heic|jxl|woff2?|ttf|otf|eot|mp4|webm|ogv|mov|m4v|mp3|m4a|aac|ogg|opus|flac|zip|gz|tgz|7z|rar|pdf|docx|xlsx|pptx|epub)$/i;

// Images, fonts and media go in stored (they're already compressed); text is deflated.
export const shouldStore = (name, contentType, type) =>
  type === 'font' || COMPRESSED_EXT.test(name) || COMPRESSED.test((contentType || '').toLowerCase());

// Downloads the chosen assets (never trusting the list: every URL goes
// through safeFetch) within the caps. Returns the files plus what was skipped.
export async function fetchAssets(items, { signal, referer }) {
  const used = new Set(['manifest.json', 'errors.txt']);
  const files = [];
  const skipped = [];
  let total = 0;

  await runPool(items, ZIP_LIMITS.concurrency, async (item) => {
    const type = ASSET_TYPES.includes(item?.type) ? item.type : 'other';
    const raw = typeof item?.url === 'string' ? item.url.slice(0, 4000) : '';
    let url;
    try {
      url = parseHttpUrl(raw);
    } catch {
      return skipped.push({ url: raw || String(item?.url ?? ''), reason: 'Not an http(s) URL' });
    }
    const perFile = withTimeout(signal, ZIP_LIMITS.fileTimeoutMs);
    try {
      const headers = { Accept: '*/*', 'User-Agent': BROWSER_UA };
      if (referer) headers.Referer = referer;
      const { res, finalUrl } = await safeFetch(url, { signal: perFile, headers });
      if (!res.ok) {
        await res.body?.cancel();
        return skipped.push({ url: url.href, reason: `HTTP ${res.status}` });
      }
      const declared = Number(res.headers.get('content-length'));
      if (declared > ZIP_LIMITS.fileBytes) {
        await res.body?.cancel();
        return skipped.push({ url: url.href, reason: 'Larger than 25 MB' });
      }
      if (declared && total + declared > ZIP_LIMITS.totalBytes) {
        await res.body?.cancel();
        return skipped.push({ url: url.href, reason: 'Zip would exceed 200 MB' });
      }
      const body = await readBytesLimited(res, ZIP_LIMITS.fileBytes);
      if (!body) return skipped.push({ url: url.href, reason: 'Larger than 25 MB' });
      if (total + body.length > ZIP_LIMITS.totalBytes) return skipped.push({ url: url.href, reason: 'Zip would exceed 200 MB' });
      total += body.length;
      const contentType = res.headers.get('content-type') || '';
      const name = entryName(finalUrl, type, contentType, used);
      files.push({ url: url.href, finalUrl, name, type, contentType, bytes: body.length, body });
    } catch (err) {
      let reason = err?.message || 'Download failed';
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') reason = 'Timed out after 20 s';
      else if (!(err instanceof HttpError)) reason = `Download failed: ${err.cause?.message || err.message}`;
      skipped.push({ url: url.href, reason });
    }
  }, signal);

  return { files, skipped, total };
}
