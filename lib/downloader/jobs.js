import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { createAlbumDir, mergeManifest } from './files';
import { forgetAlbum, registerAlbum } from './locations';

// Next compiles each route separately (and re-evaluates modules on hot
// reload), so the job list lives on globalThis to be shared by every route.
const jobs = (globalThis.__myTrackDownloadJobs ||= new Map());
const FINISHED = new Set(['completed', 'failed', 'cancelled']);

export const imageUrl = (album, name) =>
  `/api/downloader/albums/${encodeURIComponent(album)}/images/${encodeURIComponent(name)}`;

class Job {
  constructor(type, params) {
    this.id = randomUUID();
    this.type = type;
    this.status = 'queued';
    this.params = params;
    this.album = null;
    this.info = {};
    this.total = 0;
    this.completed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.message = null;
    this.files = [];
    this.errors = [];
    this.skippedItems = [];
    // One row per image, in order: pending → downloading → done | failed | skipped.
    this.items = [];
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.finishedAt = null;
    this.updatedAt = this.createdAt;
    this.controller = new AbortController();
    this.events = new EventEmitter().setMaxListeners(0);
  }

  get finished() {
    return FINISHED.has(this.status);
  }

  touch(event = 'update', payload) {
    this.updatedAt = new Date().toISOString();
    this.events.emit(event, payload);
  }

  summary() {
    const processed = this.completed + this.failed + this.skipped;
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      album: this.album,
      params: this.params,
      info: this.info,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      skipped: this.skipped,
      progress: this.total ? Math.round((processed / this.total) * 100) : this.finished ? 100 : 0,
      message: this.message,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      updatedAt: this.updatedAt,
    };
  }

  toJSON() {
    return { ...this.summary(), files: this.files, errors: this.errors, skippedItems: this.skippedItems, items: this.items };
  }
}

function prune() {
  if (jobs.size <= config.maxJobsKept) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= config.maxJobsKept) break;
    if (job.finished) jobs.delete(id);
  }
}

// Creates the album folder up front (so the caller knows where files will land), then runs in the background.
// `saveDir` is a user-chosen folder (already validated); without it albums go in the project's downloads/.
export async function startJob({ type, params, albumLabel, run, saveDir = null, subfolder = true }) {
  const job = new Job(type, params);
  const { dir: albumDir, created } = await createAlbumDir(albumLabel, saveDir ? { baseDir: saveDir, subfolder } : undefined);
  job.album = saveDir ? await registerAlbum(albumDir, { created, title: albumLabel }) : path.basename(albumDir);
  job.info.savedTo = albumDir;
  jobs.set(job.id, job);
  prune();

  const meta = {};
  const updateItem = (index, patch) => {
    const item = job.items[index];
    if (!item) return;
    Object.assign(item, patch);
    job.touch('item', item);
  };
  const ctx = {
    signal: job.controller.signal,
    albumDir,
    setTotal(n) {
      job.total = n;
      job.touch();
    },
    // The full download queue, known before any image starts.
    setItems(list) {
      job.items = list.map((it, index) => ({ index, status: 'pending', url: it.url, label: it.label || null, preview: it.preview || null }));
      job.total = job.items.length;
      job.touch('items', job.items);
      job.touch();
    },
    itemStarted(index) {
      updateItem(index, { status: 'downloading' });
    },
    setMessage(m) {
      job.message = m;
      job.touch();
    },
    setInfo(info) {
      Object.assign(job.info, info);
      job.touch();
    },
    addFile(file, fileMeta = {}, index) {
      const record = { name: file.name, bytes: file.bytes, contentType: file.contentType, url: imageUrl(job.album, file.name), sourceUrl: fileMeta.sourceUrl };
      meta[file.name] = { bytes: file.bytes, contentType: file.contentType, ...fileMeta };
      job.completed++;
      job.files.push(record);
      updateItem(index, { status: 'done', name: file.name, bytes: file.bytes, fileUrl: record.url });
      job.touch('file', record);
      job.touch();
    },
    addError(url, err, index) {
      const message = err?.cause?.message || err?.message || String(err);
      job.failed++;
      job.errors.push({ url, message });
      updateItem(index, { status: 'failed', error: message });
      job.touch();
    },
    addSkipped(url, reason, index) {
      job.skipped++;
      job.skippedItems.push({ url, reason });
      updateItem(index, { status: 'skipped', error: reason });
      job.touch();
    },
  };

  setImmediate(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.touch();
    try {
      await run(ctx);
      if (job.controller.signal.aborted) job.status = 'cancelled';
      else if (job.total > 0 && job.completed === 0) {
        job.status = 'failed';
        job.message ??= 'None of the images could be downloaded';
      } else job.status = 'completed';
    } catch (err) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.message = err.message;
    }
    if (job.status === 'cancelled') {
      for (const item of job.items) if (item.status === 'pending' || item.status === 'downloading') item.status = 'cancelled';
    }

    if (job.completed === 0) {
      // Only remove a folder this job made — never a pasted folder that already existed.
      if (created) await fs.rm(albumDir, { recursive: true, force: true });
      if (saveDir && created) await forgetAlbum(job.album);
      job.album = null;
    } else {
      await mergeManifest(albumDir, {
        version: 1,
        jobId: job.id,
        type: job.type,
        params: job.params,
        info: job.info,
        createdAt: job.createdAt,
        finishedAt: new Date().toISOString(),
        images: meta,
      }).catch((err) => console.error('Could not write manifest', err));
    }
    job.finishedAt = new Date().toISOString();
    job.touch();
    job.events.emit('done');
  });

  return job;
}

export const getJob = (id) => jobs.get(id);

export function listJobs({ status, type } = {}) {
  return [...jobs.values()]
    .filter((j) => (!status || j.status === status) && (!type || j.type === type))
    .reverse()
    .map((j) => j.summary());
}

export function cancelJob(job) {
  if (!job.finished) {
    job.message = 'Cancelled by user';
    job.controller.abort();
  }
}
