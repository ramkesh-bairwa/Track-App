import { NextResponse } from 'next/server';
import { toolRoute, readBody, HttpError, safeFetch, withTimeout } from '@/lib/toolsServer';
import { parseHttpUrl } from '@/lib/downloader/netguard';
import { runPool } from '@/lib/downloader/pool';

export const dynamic = 'force-dynamic';

const MAX_URLS = 300;

// HEAD (falling back to GET, body cancelled) for size and type.
async function probe(raw, signal) {
  let url;
  try {
    url = parseHttpUrl(raw);
  } catch {
    return { url: String(raw), error: 'Not an http(s) URL' };
  }
  try {
    let { res } = await safeFetch(url, { signal, method: 'HEAD' });
    if ([403, 405, 501].includes(res.status)) {
      await res.body?.cancel();
      ({ res } = await safeFetch(url, { signal }));
    }
    await res.body?.cancel();
    const length = Number(res.headers.get('content-length'));
    return {
      url: url.href,
      status: res.status,
      size: Number.isFinite(length) && res.headers.has('content-length') ? length : null,
      contentType: (res.headers.get('content-type') || '').split(';')[0].trim() || null,
    };
  } catch (err) {
    const timeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return { url: url.href, error: timeout ? 'Timed out' : err instanceof HttpError ? err.message : 'Request failed' };
  }
}

// POST { urls: [...] } → [{ url, status, size, contentType } | { url, error }]
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  const urls = body?.urls;
  if (!Array.isArray(urls) || !urls.length) throw new HttpError(400, 'NO_URLS', 'Send a list of URLs.');
  if (urls.length > MAX_URLS) throw new HttpError(400, 'TOO_MANY', `Check at most ${MAX_URLS} files at a time.`);
  const overall = withTimeout(request.signal, 60000);
  const results = new Array(urls.length);
  await runPool(urls, 5, async (u, i) => {
    results[i] = await probe(typeof u === 'string' ? u.slice(0, 4000) : '', withTimeout(overall, 10000));
  }, overall);
  return NextResponse.json({ results: results.filter(Boolean) });
});
