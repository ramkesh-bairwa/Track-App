// Checks a pasted "Save to" folder without creating anything: { path } → { path, exists, writable }.
import { NextResponse } from 'next/server';
import { downloaderRoute, readJson } from '@/lib/downloader/errors';
import { resolveSaveDir } from '@/lib/downloader/savePath';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request) => {
  const body = (await readJson(request)) || {};
  return NextResponse.json(await resolveSaveDir(body.path, { create: false }));
});
