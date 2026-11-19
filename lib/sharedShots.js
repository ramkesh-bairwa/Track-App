// Screenshot tool: images the user chose to share by link. Files live in
//   <shared-shots folder>/<token>.<png|jpg|webp>
// and the shared_screenshots table records who owns each one. Anyone with
// the link can view the image (that's the point of a link); only the owner
// can list or delete it.
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

export const SHOT_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const MAX_SHOT_BYTES = 25 * 1024 * 1024;
export const isToken = (t) => typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);
export const newToken = () => randomBytes(16).toString('hex');

export function sharedShotsDir() {
  if (process.env.SHARED_SHOTS_DIR) return process.env.SHARED_SHOTS_DIR;
  // Desktop app: next to its other data in the app-data folder.
  if (process.env.DOWNLOAD_ROOT) return path.join(path.dirname(process.env.DOWNLOAD_ROOT), 'shared-shots');
  return path.join(process.cwd(), 'data', 'shared-shots');
}

export const shotPath = (token, mime) => path.join(sharedShotsDir(), `${token}.${SHOT_TYPES[mime]}`);

export async function saveShot(token, mime, buffer) {
  await fs.mkdir(sharedShotsDir(), { recursive: true });
  await fs.writeFile(shotPath(token, mime), buffer);
}

export async function removeShot(token, mime) {
  await fs.rm(shotPath(token, mime), { force: true });
}

// PNG / JPEG / WebP by their first bytes, so a mislabelled upload is refused.
export function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
