import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import { toolRoute, readBody, HttpError } from '@/lib/toolsServer';
import { ZIP_LIMITS, fetchAssets, shouldStore } from '@/lib/tools/assets';

export const dynamic = 'force-dynamic';

function zipBaseName(pageUrl) {
  let host = 'page';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '') || 'page';
  } catch {}
  return `assets-${host}-${new Date().toISOString().slice(0, 10)}`;
}

// POST { pageUrl, assets: [{ url, type }] } → a zip with a folder per type,
// manifest.json (original URL → path) and errors.txt for anything skipped.
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  const assets = body?.assets;
  if (!Array.isArray(assets) || !assets.length) throw new HttpError(400, 'NO_ASSETS', 'Pick at least one file to download.');
  if (assets.length > ZIP_LIMITS.maxFiles) {
    throw new HttpError(400, 'TOO_MANY', `A zip can hold at most ${ZIP_LIMITS.maxFiles} files — select fewer.`);
  }

  let referer = null;
  if (typeof body.pageUrl === 'string') {
    try {
      const u = new URL(body.pageUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') referer = u.href;
    } catch {}
  }

  // Duplicate URLs are downloaded once.
  const seen = new Set();
  const items = assets.filter((a) => {
    const key = typeof a?.url === 'string' ? a.url : JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { files, skipped, total } = await fetchAssets(items, { signal: request.signal, referer });
  if (!files.length) {
    const first = skipped[0]?.reason ? ` (${skipped[0].reason})` : '';
    throw new HttpError(502, 'NOTHING_DOWNLOADED', `None of the selected files could be downloaded${first}.`);
  }

  const manifest = {
    page: referer,
    createdAt: new Date().toISOString(),
    files: files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ url, finalUrl, name, type, contentType, bytes }) => ({
        url, ...(finalUrl !== url ? { finalUrl } : {}), path: name, type, contentType: contentType || null, bytes,
      })),
    skipped,
  };

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (err) => console.warn('Asset zip warning:', err));
  archive.on('error', (err) => console.error('Asset zip error:', err));
  for (const f of files) {
    archive.append(f.body, { name: f.name, store: shouldStore(f.name, f.contentType, f.type) });
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  if (skipped.length) {
    const lines = skipped.map((s) => `${s.url}\t${s.reason}`);
    archive.append(`Files that were not downloaded (${skipped.length}):\n\n${lines.join('\n')}\n`, { name: 'errors.txt' });
  }
  archive.finalize();

  const name = zipBaseName(referer);
  return new Response(Readable.toWeb(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}.zip"`,
      'Cache-Control': 'no-store',
      'X-Asset-Files': String(files.length),
      'X-Asset-Skipped': String(skipped.length),
      'X-Asset-Bytes': String(total),
    },
  });
});
