import { toolRoute, readBody, HttpError } from '@/lib/toolsServer';
import { scrapeSite, buildZip, storeJob } from '@/lib/tools/siteScraper';

export const dynamic = 'force-dynamic';

// POST { url, maxPages?, maxDepth?, stayUnderPath? } → NDJSON progress lines, ending in
// { type: 'done', id, ... } (fetch the zip from /download?id=) or { type: 'error', error }.
export const POST = toolRoute(async (request, { user }) => {
  const body = await readBody(request);
  if (typeof body?.url !== 'string' || !body.url.trim()) throw new HttpError(400, 'NO_URL', 'Enter a site URL.');
  const raw = body.url.trim();
  const url = /^[a-z][a-z\d+.-]*:\/\/|^(file|data|javascript|mailto|about|blob):/i.test(raw) ? raw : `https://${raw}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      try {
        const result = await scrapeSite(url, {
          signal: request.signal,
          maxPages: body.maxPages,
          maxDepth: body.maxDepth,
          stayUnderPath: body.stayUnderPath === true,
          onProgress: send,
        });
        send({ type: 'zipping' });
        const zip = await buildZip(result);
        let host = 'site';
        try {
          host = new URL(result.root).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '') || 'site';
        } catch {}
        const name = `site-${host}-${new Date().toISOString().slice(0, 10)}.zip`;
        const id = storeJob(user.id, { zip, name });
        send({
          type: 'done',
          id,
          name,
          bytes: zip.length,
          root: result.root,
          title: result.title,
          stats: result.stats,
          pages: result.manifest.pages.map((p) => ({ url: p.url, path: p.path, title: p.title })),
          failed: [...result.manifest.failed, ...result.manifest.skipped].slice(0, 200),
          warnings: result.manifest.warnings,
        });
      } catch (err) {
        if (!(err instanceof HttpError)) console.error('Site scraper error:', err);
        const message = err instanceof HttpError ? err.message
          : err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'The site took too long to answer.'
          : 'Something went wrong. Please try again.';
        send({ type: 'error', error: message });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
});
