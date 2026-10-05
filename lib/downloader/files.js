import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { notFound } from './errors';

export const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
};

export const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
};

export const MANIFEST_FILE = '.manifest.json';

export const isImageFile = (name) =>
  !name.startsWith('.') && Object.hasOwn(EXT_TO_MIME, path.extname(name).toLowerCase());

// Same rules as sanitize_name() in downloader.py.
export function sanitizeName(name, fallback = 'images') {
  const clean = String(name).replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_');
  return clean.slice(0, 80) || fallback;
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// Creates <baseDir>/<YYYYMMDD_HHMMSS>_<label>, matching downloader.py's run
// folders. With `subfolder: false` the images go straight into baseDir.
// `created` says whether the folder is new (and so safe to remove if empty).
export async function createAlbumDir(label, { baseDir = config.downloadRoot, subfolder = true } = {}) {
  await fs.mkdir(baseDir, { recursive: true });
  if (!subfolder) return { dir: baseDir, created: false };
  const base = `${timestamp()}_${sanitizeName(label)}`;
  for (let i = 0; ; i++) {
    const name = i === 0 ? base : `${base}_${i + 1}`;
    try {
      await fs.mkdir(path.join(baseDir, name));
      return { dir: path.join(baseDir, name), created: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

// A single file name from a URL: no paths, no hidden files.
export function checkFileName(name) {
  if (!name || name.startsWith('.') || /[\\/]/.test(name) || name.includes('\0')) throw notFound();
  return name;
}

// Validates a single path segment from a URL (album or file name) and resolves it under the downloads root.
export function resolveInRoot(...segments) {
  for (const seg of segments) {
    if (!seg || seg.startsWith('.') || /[\\/]/.test(seg) || seg.includes('\0')) throw notFound();
  }
  const target = path.resolve(config.downloadRoot, ...segments);
  if (!target.startsWith(config.downloadRoot + path.sep)) throw notFound();
  return target;
}

// Opens `<base><ext>`, or `<base>_1<ext>`, `<base>_2<ext>`... atomically so parallel downloads never collide.
export async function openUnique(dir, base, ext) {
  for (let i = 0; i < 10000; i++) {
    const name = i === 0 ? `${base}${ext}` : `${base}_${i}${ext}`;
    const filePath = path.join(dir, name);
    try {
      const handle = await fs.open(filePath, 'wx');
      return { handle, name, filePath };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not find a free file name for ${base}${ext}`);
}

export async function readManifest(albumDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(albumDir, MANIFEST_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeManifest(albumDir, manifest) {
  await fs.writeFile(path.join(albumDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

// Adds a finished job's images to the folder's manifest, keeping earlier
// jobs' entries (several downloads can land in one pasted folder).
export async function mergeManifest(albumDir, manifest) {
  const old = await readManifest(albumDir);
  await writeManifest(albumDir, { ...manifest, images: { ...(old?.images || {}), ...manifest.images } });
}

// A dynamic route segment (album or file name), decoded once. Next may hand
// segments over still percent-encoded; names never contain a literal "%".
export function segment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
