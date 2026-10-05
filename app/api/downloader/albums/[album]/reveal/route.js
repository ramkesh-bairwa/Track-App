// Opens an album's folder in Finder / Explorer. Only useful when the server
// runs on the machine you're sitting at (as it does with `npm run dev`).
import { execFile } from 'node:child_process';
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';
import { segment } from '@/lib/downloader/files';
import { albumDir } from '@/lib/downloader/gallery';

export const dynamic = 'force-dynamic';

const OPENER = { darwin: 'open', win32: 'explorer', linux: 'xdg-open' }[process.platform];

export const POST = downloaderRoute(async (request, { params }) => {
  const dir = await albumDir(segment(params.album));
  if (!OPENER) return NextResponse.json({ opened: false, path: dir });
  // execFile passes the path as one argument — no shell, so nothing in it is interpreted.
  execFile(OPENER, [dir], () => {});
  return NextResponse.json({ opened: true, path: dir });
});
