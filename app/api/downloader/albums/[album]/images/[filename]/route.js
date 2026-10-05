// Phase 5 — the image file itself (usable as <img src>); ?download=1 saves it instead. DELETE removes it.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { downloaderRoute } from '@/lib/downloader/errors';
import { EXT_TO_MIME, segment } from '@/lib/downloader/files';
import { deleteImage, imagePath } from '@/lib/downloader/gallery';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request, { params }) => {
  const album = segment(params.album);
  const filename = segment(params.filename);
  const filePath = await imagePath(album, filename);
  const { size } = await fs.promises.stat(filePath);
  const download = new URL(request.url).searchParams.get('download') === '1';
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    headers: {
      'Content-Type': EXT_TO_MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=86400',
      // Downloaded files are untrusted; stop SVGs from running scripts if opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      ...(download && { 'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"` }),
    },
  });
});

export const DELETE = downloaderRoute(async (request, { params }) => {
  await deleteImage(segment(params.album), segment(params.filename));
  return new Response(null, { status: 204 });
});
