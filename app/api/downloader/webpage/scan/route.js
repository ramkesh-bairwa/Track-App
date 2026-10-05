// Phase 2 — list every image on a web page without downloading any.
import { NextResponse } from 'next/server';
import { downloaderRoute, readJson } from '@/lib/downloader/errors';
import { requireString } from '@/lib/downloader/validate';
import { scanWebpage } from '@/lib/downloader/webpage';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request) => {
  const body = await readJson(request);
  const url = requireString(body?.url, 'url');
  return NextResponse.json(await scanWebpage(url, { signal: request.signal }));
});
