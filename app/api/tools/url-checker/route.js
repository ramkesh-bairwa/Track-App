import { toolRoute, readBody, HttpError } from '@/lib/toolsServer';
import { runPool } from '@/lib/downloader/pool';
import { ERROR_LABELS, checkUrl, extractPageLinks, fetchPage, normalizeUrl } from '@/lib/tools/pageFetch';

export const dynamic = 'force-dynamic';

const MAX_URLS = 50;
const MAX_PAGE_LINKS = 100;
const CONCURRENCY = 5;
const PER_URL_MS = 10000;
const OVERALL_MS = 90000;

// POST { urls: string[] } or { pageUrl } → NDJSON stream:
// {type:'start', total, items} · {type:'result', index, ...} (as each finishes) · {type:'done', elapsedMs, stopped}
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  let items;
  let source = null;

  if (body?.pageUrl != null) {
    const { url, error } = normalizeUrl(body.pageUrl);
    if (error) throw new HttpError(400, 'BAD_URL', error === 'Empty URL' ? 'Enter the page to take links from.' : `${error}.`);
    const page = await fetchPage(url, { signal: request.signal });
    if (!page.isHtml) throw new HttpError(415, 'NOT_HTML', `That URL returned "${page.contentType.split(';')[0]}", not a web page.`);
    const { links, total, truncated } = extractPageLinks(page.html, page.finalUrl, MAX_PAGE_LINKS);
    if (!links.length) throw new HttpError(422, 'NO_LINKS', 'No http or https links were found on that page.');
    items = links.map((href) => ({ input: href, url: new URL(href) }));
    source = { pageUrl: page.finalUrl, status: page.status, linksFound: total, truncated };
  } else {
    if (!Array.isArray(body?.urls)) throw new HttpError(400, 'BAD_INPUT', 'Send "urls" (a list) or "pageUrl".');
    const seen = new Set();
    items = [];
    for (const raw of body.urls) {
      const input = String(raw ?? '').trim();
      if (!input) continue;
      const { url, error } = normalizeUrl(input);
      const key = url ? url.href : `invalid:${input}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ input, url, error });
    }
    if (!items.length) throw new HttpError(400, 'NO_URLS', 'Paste at least one URL.');
    if (items.length > MAX_URLS) throw new HttpError(400, 'TOO_MANY', `You can check up to ${MAX_URLS} URLs at a time (got ${items.length}).`);
  }

  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(OVERALL_MS)]);
  const started = performance.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // client went away
        }
      };
      send({ type: 'start', total: items.length, items: items.map((it) => it.url?.href || it.input), source });
      const done = new Set();
      await runPool(items, CONCURRENCY, async (item, index) => {
        let result;
        if (item.error) {
          result = { url: item.input, status: null, redirects: [], timeMs: 0, error: { category: 'invalid', label: ERROR_LABELS.invalid, message: item.error } };
        } else {
          result = await checkUrl(item.url, { signal, timeoutMs: PER_URL_MS });
        }
        done.add(index);
        send({ type: 'result', index, input: item.input, ...result });
      }, signal);
      // Anything not reached before the overall limit (or a client stop).
      items.forEach((item, index) => {
        if (done.has(index)) return;
        send({
          type: 'result', index, input: item.input, url: item.url?.href || item.input, status: null, redirects: [], timeMs: 0,
          error: { category: 'timeout', label: 'Skipped', message: 'Not checked: the overall time limit was reached' },
        });
      });
      send({ type: 'done', elapsedMs: Math.round(performance.now() - started), stopped: signal.aborted });
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
});
