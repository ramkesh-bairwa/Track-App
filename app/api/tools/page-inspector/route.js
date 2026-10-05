import { NextResponse } from 'next/server';
import { toolRoute, readBody, HttpError } from '@/lib/toolsServer';
import { fetchPage, normalizeUrl } from '@/lib/tools/pageFetch';
import { analyzeHeaders, analyzeHtml } from '@/lib/tools/pageInspect';

export const dynamic = 'force-dynamic';

// POST { url } → a report on that page (see lib/tools/pageInspect.js).
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  const { url, error } = normalizeUrl(body?.url);
  if (error) throw new HttpError(400, 'BAD_URL', error === 'Empty URL' ? 'Enter a URL to inspect.' : `${error}.`);

  const page = await fetchPage(url, { signal: request.signal });
  const type = page.contentType.split(';')[0].trim() || null;
  const report = {
    fetchedAt: new Date().toISOString(),
    requestedUrl: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    statusText: page.statusText,
    redirects: page.redirects,
    ttfbMs: page.ttfbMs,
    totalMs: page.totalMs,
    bytes: page.bytes,
    truncated: page.truncated,
    contentType: type,
    charset: page.charset || null,
    isHtml: page.isHtml,
    notice: page.isHtml ? null : `This URL returned "${type}", not an HTML page, so only the response details are shown.`,
    headers: analyzeHeaders(page.headers, page.finalUrl),
  };
  if (page.isHtml) Object.assign(report, analyzeHtml(page.html, page.finalUrl));
  return NextResponse.json(report);
});
