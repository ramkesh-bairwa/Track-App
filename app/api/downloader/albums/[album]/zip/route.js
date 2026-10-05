// Phase 5 — the whole album as one .zip download.
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { downloaderRoute } from '@/lib/downloader/errors';
import { segment } from '@/lib/downloader/files';
import { albumImageFiles } from '@/lib/downloader/gallery';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request, { params }) => {
  const album = segment(params.album);
  const files = await albumImageFiles(album);
  const archive = new ZipArchive({ store: true }); // images are already compressed
  archive.on('error', (err) => archive.destroy(err));
  for (const f of files) archive.file(f.filePath, { name: f.name });
  archive.finalize();
  return new Response(Readable.toWeb(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${album}.zip"`,
    },
  });
});
