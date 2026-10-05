import { NextResponse } from 'next/server';
import { toolRoute, readBody, HttpError, safeFetch, withTimeout } from '@/lib/toolsServer';
import { parseHttpUrl } from '@/lib/downloader/netguard';

export const dynamic = 'force-dynamic';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Does a frame-ancestors source list let `origin` (MyTrack's own origin) embed the page?
function ancestorsAllow(sources, origin) {
  const parent = new URL(origin);
  return sources.some((raw) => {
    const s = raw.toLowerCase();
    if (s === "'none'") return false;
    if (s === '*') return true;
    if (s === "'self'") return false; // the framed site's own origin, never ours here
    if (/^[a-z][a-z\d+.-]*:$/.test(s)) return parent.protocol === s || (s === 'http:' && parent.protocol === 'https:');
    const m = s.match(/^(?:([a-z][a-z\d+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/);
    if (!m) return false;
    const [, scheme, wildcard, host, port] = m;
    if (scheme && scheme !== parent.protocol.slice(0, -1)) return false;
    const hostOk = wildcard ? parent.hostname.endsWith(`.${host}`) : parent.hostname === host;
    const defaultPort = parent.protocol === 'https:' ? '443' : '80';
    const portOk = port === '*' || (port || defaultPort) === (parent.port || defaultPort);
    return hostOk && portOk;
  });
}

// Reads X-Frame-Options and CSP frame-ancestors the way browsers do: when a
// CSP has frame-ancestors, X-Frame-Options is ignored.
function framingVerdict(headers, origin) {
  const csp = headers.get('content-security-policy') || '';
  const ancestorLists = csp
    .split(',')
    .map((policy) => policy.split(';').map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d)))
    .filter(Boolean)
    .map((d) => d.split(/\s+/).slice(1));
  const xfo = (headers.get('x-frame-options') || '').trim();
  if (ancestorLists.length) {
    const allowed = ancestorLists.every((sources) => ancestorsAllow(sources, origin));
    return {
      allowed,
      reason: allowed ? null : `Content-Security-Policy: frame-ancestors ${ancestorLists.find((s) => !ancestorsAllow(s, origin)).join(' ') || "'none'"}`,
      xFrameOptions: xfo || null,
      frameAncestors: ancestorLists.map((s) => s.join(' ')),
    };
  }
  const values = xfo.toLowerCase().split(',').map((v) => v.trim()).filter(Boolean);
  const refused = values.some((v) => v === 'deny' || v === 'sameorigin');
  return { allowed: !refused, reason: refused ? `X-Frame-Options: ${xfo}` : null, xFrameOptions: xfo || null, frameAncestors: [] };
}

// POST { url } → can this page be shown in a frame here? Only headers are read.
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  if (typeof body?.url !== 'string' || !body.url.trim()) throw new HttpError(400, 'NO_URL', 'Enter a URL.');
  const url = parseHttpUrl(body.url);
  const origin = new URL(request.url).origin;

  let res, finalUrl, redirects;
  try {
    ({ res, finalUrl, redirects } = await safeFetch(url, {
      signal: withTimeout(request.signal, 15000),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'User-Agent': BROWSER_UA },
    }));
  } catch (err) {
    // Local and private addresses (e.g. a dev server) can't be checked from
    // here, but the browser may still reach them — let the frames try.
    if (err instanceof HttpError && err.code === 'BLOCKED_URL') {
      return NextResponse.json({ url: url.href, checked: false, skipped: 'private', message: 'Framing check skipped: this is a local or private address.' });
    }
    if (err instanceof HttpError && err.code === 'DNS_ERROR') {
      return NextResponse.json({ url: url.href, checked: false, skipped: 'dns', message: `Couldn’t find the host “${url.hostname}”.` });
    }
    const timeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return NextResponse.json({
      url: url.href,
      checked: false,
      skipped: 'error',
      message: timeout ? 'Framing check skipped: the site took too long to answer.' : `Framing check failed: ${err instanceof HttpError ? err.message : err.cause?.message || err.message}`,
    });
  }
  await res.body?.cancel();

  return NextResponse.json({
    url: url.href,
    finalUrl,
    redirected: redirects.length > 0,
    status: res.status,
    checked: true,
    ...framingVerdict(res.headers, origin),
  });
});
