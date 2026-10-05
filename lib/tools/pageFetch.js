// Server-side fetching shared by the Page Inspector and URL Checker tools.
// Every user URL goes through safeFetch, which blocks private addresses on each hop.
import * as cheerio from 'cheerio';
import { HttpError, safeFetch, withTimeout } from '@/lib/toolsServer';
import { parseHttpUrl } from '@/lib/downloader/netguard';

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BAD_SCHEME = /^(javascript|data|file|mailto|tel|ftp|about|blob|vbscript|chrome|view-source):/i;

// Accepts "example.com" as https://example.com. Returns { url } or { error }.
export function normalizeUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Empty URL' };
  if (text.length > 2048) return { error: 'URL is longer than 2048 characters' };
  if (!HAS_SCHEME.test(text) && BAD_SCHEME.test(text)) return { error: 'Only http and https URLs can be checked' };
  const candidate = HAS_SCHEME.test(text) ? text : `https://${text.replace(/^\/+/, '')}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'Not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http and https URLs can be checked' };
  if (!url.hostname) return { error: 'Not a valid URL' };
  return { url };
}

const TLS_CODES = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS/i;

// Maps whatever fetch/safeFetch threw to a category the UI can show.
export function classifyError(err) {
  if (err instanceof HttpError) {
    if (err.code === 'DNS_ERROR') return { category: 'dns', message: err.message };
    if (err.code === 'BLOCKED_URL') return { category: 'blocked', message: 'Blocked: the URL or one of its redirects points to a local or private network address' };
    if (err.code === 'TOO_MANY_REDIRECTS') return { category: 'redirects', message: err.message };
    if (err.status === 400) return { category: 'invalid', message: err.message.replace('"url"', 'The redirect target') };
    return { category: 'other', message: err.message };
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { category: 'timeout', message: 'Timed out' };
  const cause = err?.cause || {};
  const code = String(cause.code || err?.code || '');
  const detail = cause.message || err?.message || 'Request failed';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { category: 'dns', message: 'Host not found' };
  if (code === 'ECONNREFUSED') return { category: 'refused', message: 'Connection refused' };
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return { category: 'timeout', message: 'Connection timed out' };
  if (TLS_CODES.test(code) || /certificate|ssl|tls/i.test(detail)) return { category: 'tls', message: `TLS error: ${detail}` };
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return { category: 'other', message: 'Connection was reset' };
  return { category: 'other', message: detail };
}

export const ERROR_LABELS = {
  dns: 'DNS failure',
  timeout: 'Timeout',
  refused: 'Connection refused',
  tls: 'TLS error',
  blocked: 'Blocked private address',
  redirects: 'Too many redirects',
  invalid: 'Invalid URL',
  other: 'Request failed',
};

const toNum = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// ---------- URL Checker ----------

// HEAD first; GET (body cancelled) when the server dislikes HEAD or HEAD itself fails.
export async function checkUrl(url, { signal, timeoutMs = 10000 } = {}) {
  const sig = withTimeout(signal, timeoutMs);
  const started = performance.now();
  const attempt = async (method) => {
    const { res, finalUrl, redirects } = await safeFetch(url, {
      method,
      signal: sig,
      headers: { Accept: '*/*' },
    });
    await res.body?.cancel().catch(() => {});
    return { res, finalUrl, redirects, method };
  };

  let out;
  try {
    out = await attempt('HEAD');
    if ([403, 405, 501].includes(out.res.status)) out = await attempt('GET');
  } catch (err) {
    const first = classifyError(err);
    if (first.category === 'other' && !sig.aborted) {
      try {
        out = await attempt('GET');
      } catch (err2) {
        return errorResult(url, err2, started);
      }
    } else {
      return errorResult(url, err, started);
    }
  }
  const { res, finalUrl, redirects, method } = out;
  return {
    url: url.href,
    status: res.status,
    statusText: res.statusText || '',
    method,
    finalUrl,
    redirects,
    timeMs: Math.round(performance.now() - started),
    contentType: res.headers.get('content-type') || null,
    contentLength: toNum(res.headers.get('content-length')),
    https: finalUrl.startsWith('https:'),
    error: null,
  };
}

function errorResult(url, err, started) {
  const { category, message } = classifyError(err);
  return {
    url: url.href,
    status: null,
    statusText: '',
    finalUrl: null,
    redirects: [],
    timeMs: Math.round(performance.now() - started),
    contentType: null,
    contentLength: null,
    https: null,
    error: { category, label: ERROR_LABELS[category], message },
  };
}

// ---------- Page fetch (both tools) ----------

// Reads at most `limit` bytes; reports whether the body was cut short instead of failing.
async function readBytesLimited(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > limit) {
      chunks.push(value.subarray(0, limit - size));
      size = limit;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    size += value.length;
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function decode(buffer, headerCharset) {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const metaCharset =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i)?.[1] || null;
  const charset = (headerCharset || metaCharset || 'utf-8').toLowerCase();
  try {
    return { text: new TextDecoder(charset).decode(buffer), charset, metaCharset };
  } catch {
    return { text: new TextDecoder('utf-8').decode(buffer), charset: 'utf-8', metaCharset };
  }
}

const isHtmlType = (type) => !type || /html|xml/i.test(type);

// Fetches a page for inspection, with timings. Throws HttpError for network failures.
export async function fetchPage(rawUrl, { signal, timeoutMs = 15000, maxBytes = 5 * 1024 * 1024 } = {}) {
  const url = rawUrl instanceof URL ? rawUrl : parseHttpUrl(rawUrl);
  const sig = withTimeout(signal, timeoutMs);
  const started = performance.now();
  let res, finalUrl, redirects;
  try {
    ({ res, finalUrl, redirects } = await safeFetch(url, {
      signal: sig,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
    }));
  } catch (err) {
    const { category, message } = classifyError(err);
    const status = { blocked: 403, invalid: 400, timeout: 504 }[category] || 502;
    const text = {
      blocked: 'That URL (or a redirect it leads to) points to a local or private network address, which is not allowed.',
      timeout: 'The site took too long to answer.',
      other: `Could not fetch the page: ${message}`,
    }[category] || `${ERROR_LABELS[category]}: ${message}`;
    throw new HttpError(status, category.toUpperCase(), text);
  }
  const ttfbMs = Math.round(performance.now() - started);
  const contentType = res.headers.get('content-type') || '';
  const headerCharset = contentType.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1] || null;
  const base = {
    url: url.href,
    finalUrl,
    redirects,
    status: res.status,
    statusText: res.statusText || '',
    headers: res.headers,
    contentType,
    ttfbMs,
  };
  if (!isHtmlType(contentType)) {
    await res.body?.cancel().catch(() => {});
    return { ...base, html: null, isHtml: false, totalMs: ttfbMs, bytes: toNum(res.headers.get('content-length')), truncated: false, charset: headerCharset };
  }
  let body;
  try {
    body = res.body ? await readBytesLimited(res, maxBytes) : { buffer: Buffer.alloc(0), truncated: false };
  } catch (err) {
    const { category, message } = classifyError(err);
    throw new HttpError(category === 'timeout' ? 504 : 502, 'READ_FAILED', `Could not read the page: ${message}`);
  }
  const { text, charset, metaCharset } = decode(body.buffer, headerCharset);
  return {
    ...base,
    html: text,
    isHtml: true,
    totalMs: Math.round(performance.now() - started),
    bytes: body.buffer.length,
    truncated: body.truncated,
    charset,
    headerCharset,
    metaCharset,
  };
}

// http/https <a href> targets of a page, resolved, without fragments, deduped.
export function extractPageLinks(html, pageUrl, cap = 100) {
  const $ = cheerio.load(html);
  const base = resolveBase($, pageUrl);
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#')) return;
    let u;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    u.hash = '';
    seen.add(u.href);
  });
  const all = [...seen];
  return { links: all.slice(0, cap), total: all.length, truncated: all.length > cap };
}

export function resolveBase($, pageUrl) {
  try {
    return new URL($('base[href]').attr('href') ?? pageUrl, pageUrl);
  } catch {
    return new URL(pageUrl);
  }
}
