// Albums saved outside the project (a pasted "Save to" folder) are listed in
// downloads/.locations.json, so the gallery can still show, zip and delete
// them. Their album key is "@<id>" instead of a folder name.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { notFound } from './errors';
import { resolveInRoot } from './files';

const FILE = () => path.join(config.downloadRoot, '.locations.json');
const KEY = /^@([a-f0-9]{10})$/;

export const isExternalAlbum = (album) => KEY.test(album);

export async function readLocations() {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), 'utf8'));
    return data && typeof data.albums === 'object' ? data : { albums: {} };
  } catch {
    return { albums: {} };
  }
}

// Writes are serialised so two jobs finishing together can't lose an entry.
function update(fn) {
  const run = async () => {
    const data = await readLocations();
    const result = await fn(data);
    await fs.mkdir(config.downloadRoot, { recursive: true });
    await fs.writeFile(FILE(), JSON.stringify(data, null, 2));
    return result;
  };
  globalThis.__myTrackLocationsLock = (globalThis.__myTrackLocationsLock || Promise.resolve()).then(run, run);
  return globalThis.__myTrackLocationsLock;
}

// One album per folder: saving into the same folder again reuses its key.
export function registerAlbum(dir, { created, title }) {
  return update((data) => {
    const existing = Object.entries(data.albums).find(([, a]) => a.dir === dir);
    if (existing) return `@${existing[0]}`;
    const id = crypto.randomBytes(5).toString('hex');
    data.albums[id] = { dir, created: Boolean(created), title, createdAt: new Date().toISOString() };
    return `@${id}`;
  });
}

export function forgetAlbum(album) {
  const m = album.match(KEY);
  if (!m) return Promise.resolve();
  return update((data) => {
    delete data.albums[m[1]];
  });
}

// Album key → { dir, external, created, title }.
export async function locateAlbum(album) {
  const m = typeof album === 'string' && album.match(KEY);
  if (!m) return { dir: resolveInRoot(album), external: false, created: true, title: null };
  const entry = (await readLocations()).albums[m[1]];
  if (!entry) throw notFound(`Album "${album}" not found`);
  return { dir: entry.dir, external: true, created: entry.created, title: entry.title, createdAt: entry.createdAt };
}
