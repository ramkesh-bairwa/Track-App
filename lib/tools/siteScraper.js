// Website Scraper: crawls a site's same-origin pages and saves their HTML, CSS
// and JS as an offline copy. Pages become .html files that mirror the site's
// paths, stylesheets go in css/ and scripts in js/, and every link between
// saved files is rewritten to a relative path. Images, fonts and other files
// are not downloaded — their URLs are made absolute so they still load online.
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ZipArchive } from 'archiver';
import { HttpError, withTimeout } from '@/lib/toolsServer';
import { parseHttpUrl } from '@/lib/downloader/netguard';
import { runPool } from '@/lib/downloader/pool';
import { fetchPage } from '@/lib/tools/pageFetch';
import { entryName, fetchAssets, parseCss } from '@/lib/tools/assets';

export const SCRAPE_LIMITS = {
  defaultPages: 50,
  maxPages: 300,
  defaultDepth: 3,
  maxDepth: 10,
  concurrency: 4,
  pageBytes: 5 * 1024 * 1024,
  pageTimeoutMs: 15000,
  maxAssets: 500,
  cssImportDepth: 3,
  totalMs: 5 * 60 * 1000,
};

// Links with these extensions are files, not pages, so they're never crawled.
const NON_PAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|ico|tiff?|heic|woff2?|ttf|otf|eot|mp4|webm|ogg|ogv|mov|m4v|mp3|wav|m4a|aac|flac|opus|pdf|zip|rar|7z|gz|tgz|tar|dmg|exe|msi|apk|docx?|xlsx?|pptx?|csv|txt|rtf|json|xml|rss|atom|css|js|mjs|map|webmanifest)$/i;
// Server-side page extensions that become .html.
const SCRIPT_EXT = /\.(php\d?|aspx?|jsp|jspx|cfm|cgi|pl|shtml|xhtml|htm)$/i;

const sameSite = (a, b) => a.protocol === b.protocol && a.host.replace(/^www\./, '') === b.host.replace(/^www\./, '');

// Page key used for dedupe: no hash, no trailing "index.html", host without www.
function pageKey(url) {
  const u = new URL(url);
  u.hash = '';
  u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
  return `${u.protocol}//${u.host.replace(/^www\./, '')}${u.pathname}${u.search}`;
}

const cleanSegment = (s) => {
  let v = s;
  try {
    v = decodeURIComponent(s);
  } catch {}
  return v.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.\-]+|-+$/g, '').slice(0, 80);
};

// "/" → index.html, "/about" → about.html, "/blog/" → blog/index.html,
// "/shop/item.php?id=2" → shop/item-id-2.html. Names are unique (case-insensitively).
export function pagePath(url, used) {
  const u = new URL(url);
  const segments = u.pathname.split('/').map(cleanSegment);
  const isDir = u.pathname.endsWith('/');
  let file = isDir ? '' : segments.pop();
  const dirs = segments.filter(Boolean);
  file = file.replace(SCRIPT_EXT, '').replace(/\.html$/i, '');
  if (!file) file = 'index';
  if (u.search) {
    const q = cleanSegment(u.search.slice(1).replace(/[=&]/g, '-')).slice(0, 60);
    if (q) file = `${file}-${q}`;
  }
  const dir = dirs.join('/');
  const stem = dir ? `${dir}/${file}` : file;
  let name = `${stem}.html`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}.html`;
  used.add(name.toLowerCase());
  return name;
}

// Relative link from one saved file to another, e.g. "../css/site.css".
const relLink = (fromFile, toFile) => {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel || path.posix.basename(toFile);
};

function absolutize(raw, base) {
  const v = String(raw ?? '').trim();
  if (!v || v.startsWith('#') || /^(data|blob|javascript|about|mailto|tel|sms):/i.test(v)) return null;
  try {
    const u = new URL(v, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)|"([^"]*)"|'([^']*)')/gi;

// @imports point at saved stylesheets when we have them (written as plain strings so
// the url() pass leaves them alone); every other url() becomes absolute.
function rewriteCss(css, cssUrl, importFor) {
  const imported = css.replace(CSS_IMPORT, (match, a, b, c, d, e) => {
    const abs = absolutize((a ?? b ?? c ?? d ?? e ?? '').trim(), cssUrl);
    if (!abs) return match;
    return `@import ${JSON.stringify(importFor(abs) ?? abs.href)}`;
  });
  return imported.replace(CSS_URL, (match, a, b, c) => {
    const abs = absolutize((a ?? b ?? c ?? '').trim(), cssUrl);
    return abs ? `url(${JSON.stringify(abs.href)})` : match;
  });
}

function rewriteSrcset(value, base) {
  return value
    .split(/,(?=\s*\S)/)
    .map((part) => {
      const [ref, ...desc] = part.trim().split(/\s+/);
      const abs = absolutize(ref, base);
      return [abs ? abs.href : ref, ...desc].join(' ');
    })
    .join(', ');
}

// Same-origin <a href> targets that look like pages.
function pageLinks($, base, root, { stayUnder }) {
  const out = [];
  $('a[href], area[href]').each((_, el) => {
    const u = absolutize($(el).attr('href'), base);
    if (!u || !sameSite(u, root)) return;
    if (NON_PAGE_EXT.test(u.pathname)) return;
    if (stayUnder && !u.pathname.startsWith(stayUnder)) return;
    u.hash = '';
    out.push(u.href);
  });
  return out;
}

// Stylesheets and scripts a page loads.
function pageAssets($, base) {
  const out = [];
  $('link[href]').each((_, el) => {
    const rel = ($(el).attr('rel') || '').toLowerCase().split(/\s+/);
    const as = ($(el).attr('as') || '').toLowerCase();
    const u = absolutize($(el).attr('href'), base);
    if (!u) return;
    if (rel.includes('stylesheet') || (rel.includes('preload') && as === 'style')) out.push({ url: u.href, type: 'css' });
    else if (rel.includes('modulepreload') || (rel.includes('preload') && as === 'script')) out.push({ url: u.href, type: 'js' });
  });
  $('script[src]').each((_, el) => {
    const u = absolutize($(el).attr('src'), base);
    if (u) out.push({ url: u.href, type: 'js' });
  });
  return out;
}

const resolveBase = ($, pageUrl) => {
  try {
    return new URL($('base[href]').attr('href') ?? pageUrl, pageUrl);
  } catch {
    return new URL(pageUrl);
  }
};

// Crawls breadth-first from `rawUrl`. `onProgress` gets small events for the UI.
export async function scrapeSite(rawUrl, { signal, maxPages, maxDepth, stayUnderPath = false, onProgress = () => {} } = {}) {
  const startUrl = parseHttpUrl(rawUrl);
  const pageCap = Math.min(Math.max(1, Math.floor(Number(maxPages) || SCRAPE_LIMITS.defaultPages)), SCRAPE_LIMITS.maxPages);
  const depthCap = Math.min(Math.max(0, Math.floor(Number(maxDepth ?? SCRAPE_LIMITS.defaultDepth))), SCRAPE_LIMITS.maxDepth);
  const overall = withTimeout(signal, SCRAPE_LIMITS.totalMs);

  // The first fetch decides the real origin (after redirects, e.g. http → https).
  const first = await fetchPage(startUrl, { signal: withTimeout(overall, SCRAPE_LIMITS.pageTimeoutMs), maxBytes: SCRAPE_LIMITS.pageBytes });
  if (first.status >= 400) throw new HttpError(502, 'PAGE_HTTP_ERROR', `The page answered with HTTP ${first.status}.`);
  if (!first.isHtml) throw new HttpError(415, 'NOT_HTML', `That URL is a "${first.contentType.split(';')[0]}" file, not a web page.`);
  const root = new URL(first.finalUrl);
  const stayUnder = stayUnderPath ? root.pathname.replace(/[^/]*$/, '') : null;

  const pages = new Map(); // pageKey → { url, finalUrl, html, depth, title }
  const aliases = new Map(); // any requested/final key → canonical key
  const queued = new Set();
  const warnings = [];
  const failed = [];

  const accept = (requested, result, depth) => {
    const finalKey = pageKey(result.finalUrl);
    const reqKey = pageKey(requested);
    if (pages.has(finalKey)) {
      aliases.set(reqKey, finalKey);
      return null;
    }
    const $ = cheerio.load(result.html);
    const page = { url: requested, finalUrl: result.finalUrl, html: result.html, depth, $, title: $('title').first().text().trim().slice(0, 200) };
    pages.set(finalKey, page);
    aliases.set(reqKey, finalKey);
    aliases.set(finalKey, finalKey);
    if (result.truncated) warnings.push(`${result.finalUrl} is larger than 5 MB and was cut short.`);
    onProgress({ type: 'page', url: result.finalUrl, title: page.title, done: pages.size, limit: pageCap });
    return page;
  };

  accept(startUrl.href, first, 0);
  queued.add(pageKey(startUrl.href));
  queued.add(pageKey(first.finalUrl));

  let frontier = [...pages.values()];
  for (let depth = 1; depth <= depthCap && frontier.length && pages.size < pageCap && !overall.aborted; depth++) {
    const next = [];
    for (const page of frontier) {
      for (const href of pageLinks(page.$, resolveBase(page.$, page.finalUrl), root, { stayUnder })) {
        const key = pageKey(href);
        if (queued.has(key)) continue;
        queued.add(key);
        next.push(href);
      }
    }
    const batch = next.slice(0, pageCap - pages.size);
    if (next.length > batch.length) warnings.push(`Stopped at the ${pageCap}-page limit; ${next.length - batch.length} more links weren’t followed.`);
    const found = [];
    await runPool(batch, SCRAPE_LIMITS.concurrency, async (href) => {
      if (pages.size >= pageCap) return;
      try {
        const res = await fetchPage(href, { signal: withTimeout(overall, SCRAPE_LIMITS.pageTimeoutMs), maxBytes: SCRAPE_LIMITS.pageBytes });
        if (res.status >= 400) return failed.push({ url: href, reason: `HTTP ${res.status}` });
        if (!res.isHtml) return; // a file behind an extension-less link; not a page
        if (!sameSite(new URL(res.finalUrl), root)) return failed.push({ url: href, reason: `Redirects off-site to ${res.finalUrl}` });
        const page = accept(href, res, depth);
        if (page) found.push(page);
      } catch (err) {
        failed.push({ url: href, reason: err?.message || 'Request failed' });
        onProgress({ type: 'fail', url: href });
      }
    }, overall);
    frontier = found;
  }
  if (overall.aborted && !signal?.aborted) warnings.push('Stopped after 5 minutes; the pages fetched so far were saved.');
  if (signal?.aborted) throw new HttpError(499, 'CANCELLED', 'Cancelled.');

  // ---- Stylesheets and scripts ----
  const assetUrls = new Map(); // url → type
  for (const page of pages.values()) {
    const base = resolveBase(page.$, page.finalUrl);
    for (const a of pageAssets(page.$, base)) if (!assetUrls.has(a.url)) assetUrls.set(a.url, a.type);
    page.$('style').each((_, el) => {
      for (const ref of parseCss(page.$(el).text()).imports) {
        const u = absolutize(ref, base);
        if (u && !assetUrls.has(u.href)) assetUrls.set(u.href, 'css');
      }
    });
  }
  let assetList = [...assetUrls].map(([url, type]) => ({ url, type }));
  if (assetList.length > SCRAPE_LIMITS.maxAssets) {
    warnings.push(`Only the first ${SCRAPE_LIMITS.maxAssets} of ${assetList.length} stylesheets and scripts were saved.`);
    assetList = assetList.slice(0, SCRAPE_LIMITS.maxAssets);
  }
  onProgress({ type: 'assets', count: assetList.length });

  const assets = new Map(); // requested url → { finalUrl, type, contentType, body }
  const skipped = [];
  let round = assetList;
  for (let level = 0; round.length && !signal?.aborted; level++) {
    const { files, skipped: miss } = await fetchAssets(round, { signal, referer: root.href });
    skipped.push(...miss);
    for (const f of files) assets.set(f.url, f);
    onProgress({ type: 'assets-done', done: assets.size });
    if (level >= SCRAPE_LIMITS.cssImportDepth) break;
    // Follow @imports inside the stylesheets just fetched.
    const more = [];
    for (const f of files) {
      if (f.type !== 'css') continue;
      for (const ref of parseCss(f.body.toString('utf8')).imports) {
        const u = absolutize(ref, f.finalUrl);
        if (u && !assetUrls.has(u.href) && assetUrls.size < SCRAPE_LIMITS.maxAssets) {
          assetUrls.set(u.href, 'css');
          more.push({ url: u.href, type: 'css' });
        }
      }
    }
    round = more;
  }
  if (signal?.aborted) throw new HttpError(499, 'CANCELLED', 'Cancelled.');

  // ---- Local file names ----
  const used = new Set(['manifest.json', 'errors.txt']);
  const pageFiles = new Map(); // canonical key → file
  for (const [key, page] of pages) {
    page.file = pagePath(page.finalUrl, used);
    pageFiles.set(key, page.file);
  }
  const assetFiles = new Map(); // requested and final url → file
  for (const [url, f] of assets) {
    f.file = entryName(f.finalUrl, f.type, f.type === 'css' ? 'text/css' : 'text/javascript', used);
    assetFiles.set(url, f.file);
    assetFiles.set(f.finalUrl, f.file);
  }
  const pageFileFor = (u) => {
    const key = aliases.get(pageKey(u.href)) ?? pageKey(u.href);
    return pageFiles.get(key) ?? null;
  };
  const assetFileFor = (u) => {
    const v = new URL(u.href);
    v.hash = '';
    return assetFiles.get(v.href) ?? null;
  };

  // ---- Rewrite and zip ----
  const out = [];
  for (const f of assets.values()) {
    if (f.type !== 'css') {
      out.push({ name: f.file, body: f.body });
      continue;
    }
    const css = rewriteCss(f.body.toString('utf8'), f.finalUrl, (u) => {
      const local = assetFileFor(u);
      return local ? relLink(f.file, local) : null;
    });
    out.push({ name: f.file, body: Buffer.from(css, 'utf8') });
  }
  for (const page of pages.values()) {
    out.push({ name: page.file, body: Buffer.from(rewritePage(page, { pageFileFor, assetFileFor }), 'utf8') });
  }

  const manifest = {
    site: root.href,
    createdAt: new Date().toISOString(),
    pages: [...pages.values()].map((p) => ({ url: p.finalUrl, path: p.file, title: p.title || null, depth: p.depth })),
    assets: [...assets.values()].map((f) => ({ url: f.finalUrl, path: f.file, type: f.type, bytes: f.bytes })),
    failed,
    skipped,
    warnings,
  };

  return {
    root: root.href,
    title: pages.values().next().value?.title || null,
    files: out,
    manifest,
    stats: {
      pages: pages.size,
      css: [...assets.values()].filter((f) => f.type === 'css').length,
      js: [...assets.values()].filter((f) => f.type === 'js').length,
      failed: failed.length + skipped.length,
    },
  };
}

function rewritePage(page, { pageFileFor, assetFileFor }) {
  const { $ } = page;
  const base = resolveBase($, page.finalUrl);
  const here = page.file;
  const toLocal = (file) => relLink(here, file);

  $('base').remove();
  // The text is re-encoded as UTF-8, so the declared charset must say so.
  $('meta[charset]').attr('charset', 'utf-8');
  let declared = $('meta[charset]').length > 0;
  $('meta[http-equiv]').each((_, el) => {
    if (!/^content-type$/i.test($(el).attr('http-equiv') || '')) return;
    $(el).attr('content', 'text/html; charset=utf-8');
    declared = true;
  });
  if (!declared) $('head').prepend('<meta charset="utf-8">');

  // Links between pages.
  $('a[href], area[href], form[action], iframe[src]').each((_, el) => {
    const attr = el.name === 'form' ? 'action' : el.name === 'iframe' ? 'src' : 'href';
    const raw = $(el).attr(attr);
    const u = absolutize(raw, base);
    if (!u) return;
    const local = pageFileFor(u);
    if (local && el.name !== 'form') $(el).attr(attr, toLocal(local) + (u.hash || ''));
    else $(el).attr(attr, u.href);
  });

  // Stylesheets and scripts we saved. Integrity hashes no longer match a rewritten stylesheet.
  $('link[href], script[src]').each((_, el) => {
    const attr = el.name === 'script' ? 'src' : 'href';
    const u = absolutize($(el).attr(attr), base);
    if (!u) return;
    const local = assetFileFor(u);
    if (local) {
      $(el).attr(attr, toLocal(local));
      $(el).removeAttr('integrity');
      $(el).removeAttr('crossorigin');
    } else {
      $(el).attr(attr, u.href);
    }
  });

  // Everything else (images, fonts, media…) keeps loading from the live site.
  for (const attr of ['src', 'poster', 'data-src', 'data-original', 'data-lazy-src', 'data-bg', 'data-background']) {
    $(`[${attr}]:not(script, iframe)`).each((_, el) => {
      const u = absolutize($(el).attr(attr), base);
      if (u) $(el).attr(attr, u.href);
    });
  }
  $('object[data]').each((_, el) => {
    const u = absolutize($(el).attr('data'), base);
    if (u) $(el).attr('data', u.href);
  });
  $('image, use').each((_, el) => {
    for (const attr of ['href', 'xlink:href']) {
      const v = $(el).attr(attr);
      if (!v || v.startsWith('#')) continue;
      const u = absolutize(v, base);
      if (u) $(el).attr(attr, u.href);
    }
  });
  for (const attr of ['srcset', 'data-srcset']) {
    $(`[${attr}]`).each((_, el) => $(el).attr(attr, rewriteSrcset($(el).attr(attr), base)));
  }
  $('meta[content]').each((_, el) => {
    const key = $(el).attr('property') || $(el).attr('name') || '';
    if (/^(og:(image|video|audio|url)(:.*)?|twitter:image(:src)?)$/i.test(key)) {
      const u = absolutize($(el).attr('content'), base);
      if (u) $(el).attr('content', u.href);
    }
  });
  $('[style*="url("]').each((_, el) => {
    $(el).attr('style', rewriteCss($(el).attr('style'), base, () => null));
  });
  $('style').each((_, el) => {
    const css = rewriteCss($(el).text(), base, (u) => {
      const local = assetFileFor(u);
      return local ? toLocal(local) : null;
    });
    $(el).text(css);
  });

  return $.html();
}

// Builds the zip in memory: the saved files, manifest.json and errors.txt.
export async function buildZip({ files, manifest }) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const f of files) archive.append(f.body, { name: f.name });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  const misses = [...manifest.failed, ...manifest.skipped];
  if (misses.length) {
    archive.append(`Not saved (${misses.length}):\n\n${misses.map((m) => `${m.url}\t${m.reason}`).join('\n')}\n`, { name: 'errors.txt' });
  }
  archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

// Finished zips wait here (one per user, 10 minutes) until the browser downloads them.
const JOBS = (globalThis.__siteScraperJobs ??= new Map());
const JOB_TTL_MS = 10 * 60 * 1000;

export function storeJob(userId, job) {
  const now = Date.now();
  for (const [id, j] of JOBS) if (j.expires < now || j.userId === userId) JOBS.delete(id);
  const id = crypto.randomUUID();
  JOBS.set(id, { ...job, userId, expires: now + JOB_TTL_MS });
  return id;
}

export function takeJob(userId, id) {
  const job = JOBS.get(id);
  if (!job || job.userId !== userId || job.expires < Date.now()) return null;
  return job;
}
