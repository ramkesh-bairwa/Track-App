// "Save to" folders the user pastes in. Everything else stays in config.downloadRoot.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError, badRequest } from './errors';

// Folders a pasted path may point into. Defaults to the home folder and
// external drives; override with DOWNLOADER_ALLOWED_ROOTS=/a,/b in .env.
export function allowedRoots() {
  const fromEnv = (process.env.DOWNLOADER_ALLOWED_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const roots = fromEnv.length ? fromEnv : [os.homedir(), '/Volumes'];
  return roots.map((r) => path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())));
}

const inside = (p, root) => p === root || p.startsWith(root + path.sep);

function normalise(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1024 || raw.includes('\0')) {
    throw badRequest('"saveTo" must be a folder path');
  }
  // Paths copied from Finder / a terminal often arrive quoted, escaped or as file:// URLs.
  let p = raw.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      throw badRequest('"saveTo" is not a valid file:// path');
    }
  }
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) throw badRequest('Use a full folder path, e.g. /Users/you/Pictures/cats or ~/Pictures/cats');
  return path.resolve(p);
}

function checkAllowed(p) {
  const roots = allowedRoots();
  const root = roots.find((r) => inside(p, r));
  if (!root) throw new HttpError(403, 'PATH_NOT_ALLOWED', `The folder must be inside ${roots.join(' or ')}`);
  if (path.relative(root, p).split(path.sep).some((seg) => seg.startsWith('.'))) {
    throw new HttpError(403, 'PATH_NOT_ALLOWED', 'Hidden folders (names starting with ".") can’t be used');
  }
}

// Nearest part of the path that already exists — used to follow symlinks
// before anything is created.
async function existingAncestor(p) {
  for (let cur = p; ; cur = path.dirname(cur)) {
    try {
      return { dir: await fs.realpath(cur), rest: path.relative(cur, p) };
    } catch {
      if (path.dirname(cur) === cur) throw badRequest('That folder path does not exist');
    }
  }
}

// Validates a pasted folder and returns its real absolute path.
// `create: false` only reports on it (for the "Check" button).
export async function resolveSaveDir(raw, { create = true } = {}) {
  const p = normalise(raw);
  checkAllowed(p);
  const { dir, rest } = await existingAncestor(p);
  const real = rest ? path.join(dir, rest) : dir;
  checkAllowed(real); // a symlink must not lead somewhere else
  const exists = !rest;
  if (exists) {
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw badRequest('That path is a file, not a folder');
  }
  if (!create) {
    let writable = false;
    try {
      await fs.access(exists ? real : dir, fs.constants.W_OK);
      writable = true;
    } catch {}
    return { path: real, exists, writable };
  }
  await fs.mkdir(real, { recursive: true });
  try {
    await fs.access(real, fs.constants.W_OK);
  } catch {
    throw new HttpError(403, 'NOT_WRITABLE', `Can’t save into ${real} (no write permission)`);
  }
  return { path: real, exists: true, writable: true };
}

// `saveTo` / `subfolder` from a download request body.
export async function saveOptions(body) {
  if (body.saveTo === undefined || body.saveTo === null || body.saveTo === '') return { saveDir: null, subfolder: true };
  const { path: saveDir } = await resolveSaveDir(body.saveTo);
  return { saveDir, subfolder: body.subfolder !== false };
}
