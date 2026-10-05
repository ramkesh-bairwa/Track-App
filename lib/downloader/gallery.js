import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { notFound } from './errors';
import { EXT_TO_MIME, MANIFEST_FILE, checkFileName, isImageFile, readManifest, writeManifest } from './files';
import { imageUrl } from './jobs';
import { forgetAlbum, locateAlbum, readLocations } from './locations';

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

function parseAlbumName(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/);
  if (!m) return { title: name, createdAt: null };
  const [, y, mo, d, h, mi, s, title] = m;
  return { title, createdAt: new Date(+y, mo - 1, +d, +h, +mi, +s).toISOString() };
}

// In a pasted folder that already held other files, only the images this
// tool downloaded (the ones in its manifest) belong to the album.
async function readImages(albumDir, { onlyManifest = null } = {}) {
  const entries = await fs.readdir(albumDir, { withFileTypes: true });
  const images = await Promise.all(
    entries
      .filter((e) => e.isFile() && isImageFile(e.name) && (!onlyManifest || Object.hasOwn(onlyManifest, e.name)))
      .map(async (e) => {
        const stat = await fs.stat(path.join(albumDir, e.name));
        return { name: e.name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      }),
  );
  return images.sort((a, b) => naturalCompare(a.name, b.name));
}

// Album key → its folder, manifest and image list.
async function openAlbum(album) {
  const loc = await locateAlbum(album);
  const stat = await fs.stat(loc.dir).catch(() => null);
  if (!stat?.isDirectory()) throw notFound(`Album "${album}" not found`);
  const manifest = await readManifest(loc.dir);
  const onlyManifest = loc.external && !loc.created ? manifest?.images || {} : null;
  const images = await readImages(loc.dir, { onlyManifest });
  const parsed = parseAlbumName(path.basename(loc.dir));
  return {
    ...loc,
    stat,
    manifest,
    images,
    title: loc.title || parsed.title,
    createdAt: parsed.createdAt || loc.createdAt || stat.birthtime.toISOString(),
  };
}

function albumSummary(name, a) {
  return {
    name,
    title: a.title,
    source: a.manifest?.type || 'unknown',
    params: a.manifest?.params || null,
    imageCount: a.images.length,
    totalBytes: a.images.reduce((sum, img) => sum + img.bytes, 0),
    coverUrl: a.images[0] ? imageUrl(name, a.images[0].name) : null,
    createdAt: a.createdAt,
    path: a.dir,
    external: a.external,
  };
}

export async function listAlbums({ includeEmpty = false } = {}) {
  let entries = [];
  try {
    entries = await fs.readdir(config.downloadRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const keys = [
    ...entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name),
    ...Object.keys((await readLocations()).albums).map((id) => `@${id}`),
  ];

  const albums = await Promise.all(
    keys.map(async (key) => {
      try {
        return albumSummary(key, await openAlbum(key));
      } catch {
        return null; // a pasted folder that was moved or deleted
      }
    }),
  );

  return albums
    .filter((a) => a && (includeEmpty || a.imageCount > 0))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAlbum(album, { page, limit, sort }) {
  const a = await openAlbum(album);
  const { images, manifest } = a;
  if (sort === 'newest') images.sort((x, y) => y.modifiedAt.localeCompare(x.modifiedAt));
  else if (sort === 'largest') images.sort((x, y) => y.bytes - x.bytes);

  const totalPages = Math.max(1, Math.ceil(images.length / limit));
  const slice = images.slice((page - 1) * limit, page * limit);

  return {
    ...albumSummary(album, a),
    info: manifest?.info || null,
    pagination: { page, limit, total: images.length, totalPages, hasNextPage: page < totalPages },
    images: slice.map((img) => {
      const url = imageUrl(album, img.name);
      const { bytes: _b, contentType: _c, ...meta } = manifest?.images?.[img.name] || {};
      return {
        ...img,
        contentType: EXT_TO_MIME[path.extname(img.name).toLowerCase()],
        url,
        downloadUrl: `${url}?download=1`,
        meta,
      };
    }),
  };
}

export async function imagePath(album, filename) {
  checkFileName(filename);
  const a = await openAlbum(album);
  if (!isImageFile(filename) || !a.images.some((img) => img.name === filename)) {
    throw notFound(`Image "${filename}" not found in "${album}"`);
  }
  return path.join(a.dir, filename);
}

export async function albumDir(album) {
  return (await openAlbum(album)).dir;
}

export async function albumImageFiles(album) {
  const a = await openAlbum(album);
  return a.images.map((img) => ({ name: img.name, filePath: path.join(a.dir, img.name) }));
}

export async function deleteAlbum(album) {
  const a = await openAlbum(album);
  if (!a.external) {
    await fs.rm(a.dir, { recursive: true, force: true });
    return;
  }
  // A pasted folder: remove only what this tool downloaded, then the folder
  // itself if it made it and nothing else is left in it.
  await Promise.all(a.images.map((img) => fs.rm(path.join(a.dir, img.name), { force: true })));
  await fs.rm(path.join(a.dir, MANIFEST_FILE), { force: true });
  if (a.created) await fs.rmdir(a.dir).catch(() => {});
  await forgetAlbum(album);
}

export async function deleteImage(album, filename) {
  const filePath = await imagePath(album, filename);
  await fs.rm(filePath);
  const dir = path.dirname(filePath);
  const manifest = await readManifest(dir);
  if (manifest?.images?.[filename]) {
    delete manifest.images[filename];
    await writeManifest(dir, manifest);
  }
}
