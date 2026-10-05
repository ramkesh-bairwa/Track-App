import { NextResponse } from 'next/server';
import { toolRoute, readBody, HttpError } from '@/lib/toolsServer';
import { scanAssets } from '@/lib/tools/assets';

export const dynamic = 'force-dynamic';

// POST { url, includeDocuments? } → every asset found on the page.
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  if (typeof body?.url !== 'string' || !body.url.trim()) throw new HttpError(400, 'NO_URL', 'Enter a page URL.');
  const raw = body.url.trim();
  const url = /^[a-z][a-z\d+.-]*:\/\/|^(file|data|javascript|mailto|about|blob):/i.test(raw) ? raw : `https://${raw}`;
  const result = await scanAssets(url, { signal: request.signal, includeDocuments: body.includeDocuments === true });
  return NextResponse.json(result);
});
