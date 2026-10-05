import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from './config';
import { HttpError } from './errors';
import { EXT_TO_MIME, sanitizeName } from './files';
import { parseHttpUrl, safeFetch } from './netguard';
import { runPool, withTimeout } from './pool';
import { downloadImage } from './imageDownloader';

const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-hi-res-src', 'src'];
const META_SELECTORS = [
  'meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[property="og:image:secure_url"]',
  'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'meta[itemprop="image"]',
];
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

function parseSrcset(srcset) {
  const candidates = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
    if (i >= srcset.length) break;
    let start = i;
    while (i < srcset.length && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      start = i;
      while (i < srcset.length && srcset[i] !== ',') i++;
      descriptor = srcset.slice(start, i).trim();
    }
    const m = descriptor.match(/^([\d.]+)([wx])$/);
    candidates.push({ url, w: m?.[2] === 'w' ? Number(m[1]) : 0, x: m?.[2] === 'x' ? Number(m[1]) : 1 });
  }
  return candidates;
}

// Picks the largest candidate from a srcset attribute.
function bestFromSrcset(srcset) {
  if (!srcset) return null;
  const sorted = parseSrcset(srcset).sort((a, b) => b.w - a.w || b.x - a.x);
  return sorted[0]?.url || null;
}

const hasImageExt = (url) => Object.hasOwn(EXT_TO_MIME, path.extname(url.pathname).toLowerCase());
const toInt = (v) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : null);

export async function readTextLimited(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'PAGE_TOO_LARGE', `Page is larger than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function extractImages(html, pageUrl) {
  const $ = cheerio.load(html);
  let base;
  try {
    base = new URL($('base[href]').attr('href') ?? pageUrl, pageUrl);
  } catch {
    base = new URL(pageUrl);
  }

  const found = new Map();
  const add = (raw, source, { alt = null, width = null, height = null, requireImageExt = false } = {}) => {
    const value = raw?.trim();
    if (!value || /^(data|blob|javascript):/i.test(value)) return;
    let url;
    try {
      url = new URL(value, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (requireImageExt && !hasImageExt(url)) return;
    url.hash = '';
    if (!found.has(url.href)) {
      found.set(url.href, { url: url.href, source, alt: alt || null, width: toInt(width), height: toInt(height) });
    }
  };

  $('img').each((_, el) => {
    const img = $(el);
    const src =
      bestFromSrcset(img.attr('srcset')) ||
      bestFromSrcset(img.attr('data-srcset')) ||
      LAZY_SRC_ATTRS.map((a) => img.attr(a)).find((v) => v && !/^data:/i.test(v.trim()));
    add(src, 'img', { alt: img.attr('alt'), width: img.attr('width'), height: img.attr('height') });
  });
  $('source[srcset], source[data-srcset]').each((_, el) => {
    add(bestFromSrcset($(el).attr('srcset') || $(el).attr('data-srcset')), 'picture');
  });
  $(META_SELECTORS.join(',')).each((_, el) => add($(el).attr('content'), 'meta'));
  $('video[poster]').each((_, el) => add($(el).attr('poster'), 'poster'));
  $('[style*="url("]').each((_, el) => {
    for (const m of ($(el).attr('style') || '').matchAll(CSS_URL)) add(m[2], 'css-background');
  });
  $('style').each((_, el) => {
    for (const m of $(el).text().matchAll(CSS_URL)) add(m[2], 'css', { requireImageExt: true });
  });
  $('a[href]').each((_, el) => add($(el).attr('href'), 'link', { requireImageExt: true }));
  $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="image_src"]').each((_, el) =>
    add($(el).attr('href'), 'icon'),
  );

  return { title: $('title').first().text().trim() || null, images: [...found.values()] };
}

export async function scanWebpage(rawUrl, { signal } = {}) {
  const pageUrl = parseHttpUrl(rawUrl);
  let res, finalUrl;
  try {
    ({ res, finalUrl } = await safeFetch(pageUrl, {
      signal: withTimeout(signal, config.pageTimeoutMs),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'FETCH_FAILED', `Could not fetch page: ${err.cause?.message || err.message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(502, 'PAGE_HTTP_ERROR', `Page responded with HTTP ${res.status}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.startsWith('image/')) {
    await res.body?.cancel();
    return { url: pageUrl.href, finalUrl, title: null, total: 1, truncated: false, images: [{ url: finalUrl, source: 'direct', alt: null, width: null, height: null }] };
  }
  if (contentType && !contentType.includes('html') && !contentType.includes('xml')) {
    await res.body?.cancel();
    throw new HttpError(415, 'NOT_HTML', `URL returned "${contentType.split(';')[0]}", not a web page`);
  }

  const html = await readTextLimited(res, config.maxPageBytes);
  const { title, images } = extractImages(html, finalUrl);
  return {
    url: pageUrl.href,
    finalUrl,
    title,
    total: images.length,
    truncated: images.length > config.maxWebpageImages,
    images: images.slice(0, config.maxWebpageImages),
  };
}

function baseNameFor(imageUrl, index) {
  let stem = '';
  try {
    const { pathname } = new URL(imageUrl);
    stem = decodeURIComponent(path.basename(pathname, path.extname(pathname)));
  } catch {}
  const prefix = String(index + 1).padStart(3, '0');
  const clean = sanitizeName(stem, '');
  return clean ? `${prefix}_${clean}` : `${prefix}_image`;
}

// Job runner: downloads either the caller's chosen imageUrls, or everything found on the page.
export async function runWebpageDownload(ctx, { url, imageUrls, limit, minBytes }) {
  let targets;
  if (imageUrls?.length) {
    targets = imageUrls.map((u) => ({ url: u, source: 'selected', alt: null }));
  } else {
    const scan = await scanWebpage(url, { signal: ctx.signal });
    ctx.setInfo({ pageTitle: scan.title, finalUrl: scan.finalUrl });
    targets = scan.images;
  }
  targets = targets.slice(0, limit);
  ctx.setItems(targets.map((t) => ({ url: t.url, label: t.alt || null, preview: t.url })));
  if (!targets.length) ctx.setMessage('No images found on the page');

  await runPool(targets, config.downloadConcurrency, async (img, i) => {
    ctx.itemStarted(i);
    try {
      const file = await downloadImage(img.url, ctx.albumDir, baseNameFor(img.url, i), { signal: ctx.signal });
      if (minBytes && file.bytes < minBytes) {
        await fs.rm(file.filePath, { force: true });
        return ctx.addSkipped(img.url, `Smaller than ${minBytes} bytes`, i);
      }
      ctx.addFile(file, { sourceUrl: img.url, pageUrl: url || null, alt: img.alt, foundIn: img.source }, i);
    } catch (err) {
      ctx.addError(img.url, err, i);
    }
  }, ctx.signal);
}
