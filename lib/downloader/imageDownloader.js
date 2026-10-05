import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config';
import { EXT_TO_MIME, MIME_TO_EXT, openUnique } from './files';
import { safeFetch } from './netguard';
import { withTimeout } from './pool';

// Streams one image URL into `dir` as `<baseName><ext>`. Rejects non-image responses and oversized files.
export async function downloadImage(url, dir, baseName, { signal } = {}) {
  const sig = withTimeout(signal, config.downloadTimeoutMs);
  const { res } = await safeFetch(url, {
    signal: sig,
    // Ask for everyday formats first: CDNs like Pexels' otherwise answer with
    // AVIF/WebP, which many photo apps can't open.
    headers: { Accept: 'image/jpeg,image/png,image/gif,image/*;q=0.8,*/*;q=0.5' },
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  const urlLooksLikeImage = Object.hasOwn(EXT_TO_MIME, urlExt);
  const genericType = !contentType || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream';
  if (!contentType.startsWith('image/') && !(genericType && urlLooksLikeImage)) {
    await res.body.cancel();
    throw new Error(`Not an image (content-type: ${contentType || 'unknown'})`);
  }

  const declared = Number(res.headers.get('content-length'));
  if (declared > config.maxImageBytes) {
    await res.body.cancel();
    throw new Error(`File is larger than the ${config.maxImageBytes} byte limit`);
  }

  // Name the file after what was actually sent (a ".jpeg" URL can still
  // come back as AVIF); fall back to the URL's extension for generic types.
  const typeExt = MIME_TO_EXT[contentType];
  const sameType = typeExt && urlLooksLikeImage && EXT_TO_MIME[urlExt] === EXT_TO_MIME[typeExt];
  const ext = sameType ? urlExt : typeExt || (urlLooksLikeImage ? urlExt : '.jpg');
  const { handle, name, filePath } = await openUnique(dir, baseName, ext);

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > config.maxImageBytes) cb(new Error(`File is larger than the ${config.maxImageBytes} byte limit`));
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), limiter, handle.createWriteStream(), { signal: sig });
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.rm(filePath, { force: true });
    throw err;
  }

  return { name, filePath, bytes, contentType: contentType.startsWith('image/') ? contentType : EXT_TO_MIME[ext] };
}
