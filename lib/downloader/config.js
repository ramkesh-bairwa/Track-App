// Image downloader (ported from scripts/downloader/api) — settings, all optional in .env.
import fs from 'node:fs';
import path from 'node:path';

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  downloadRoot: path.resolve(process.env.DOWNLOAD_ROOT || path.join(process.cwd(), 'downloads')),
  // Optional: lets tools outside the browser (curl, Postman) call the API
  // without a MyTrack login — send it as x-api-key, Bearer, or ?token=.
  apiToken: process.env.DOWNLOADER_API_TOKEN || '',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (compatible; image-downloader-api/1.0)',
  // Blocks fetching localhost / private-network URLs unless explicitly allowed.
  allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS === 'true',
  pageTimeoutMs: int(process.env.PAGE_TIMEOUT_MS, 15000),
  downloadTimeoutMs: int(process.env.DOWNLOAD_TIMEOUT_MS, 60000),
  maxPageBytes: int(process.env.MAX_PAGE_BYTES, 10 * 1024 * 1024),
  maxImageBytes: int(process.env.MAX_IMAGE_BYTES, 50 * 1024 * 1024),
  downloadConcurrency: int(process.env.DOWNLOAD_CONCURRENCY, 4),
  maxPexelsCount: 1000,
  maxWebpageImages: 500,
  maxJobsKept: 200,
};

export function getPexelsApiKey() {
  const fromEnv = (process.env.PEXELS_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  if (!process.env.PEXELS_API_KEY_FILE) return '';
  try {
    return fs.readFileSync(process.env.PEXELS_API_KEY_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}
