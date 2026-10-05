import { config, getPexelsApiKey } from './config';
import { HttpError } from './errors';
import { sanitizeName } from './files';
import { runPool, withTimeout } from './pool';
import { downloadImage } from './imageDownloader';

const SEARCH_URL = 'https://api.pexels.com/v1/search';
const PAGE_SIZE = 80; // Pexels maximum

export const PEXELS_QUALITIES = {
  original: 'Original (largest file)',
  large2x: 'Large',
  large: 'Large (940px wide)',
  medium: 'Medium',
  small: 'Small',
  portrait: 'Portrait crop (800x1200)',
  landscape: 'Landscape crop (1200x627)',
  tiny: 'Tiny thumbnail',
};
export const PEXELS_ORIENTATIONS = ['landscape', 'portrait', 'square'];
export const PEXELS_SIZES = ['large', 'medium', 'small'];

async function pexelsSearch(params, signal) {
  const apiKey = getPexelsApiKey();
  if (!apiKey) {
    throw new HttpError(503, 'PEXELS_KEY_MISSING', 'Pexels API key is not configured. Set PEXELS_API_KEY or create .pexels_api_key');
  }
  const url = new URL(SEARCH_URL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: apiKey }, signal: withTimeout(signal, config.pageTimeoutMs) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new HttpError(502, 'PEXELS_UNREACHABLE', `Could not reach Pexels: ${err.cause?.message || err.message}`);
  }
  if (res.status === 401) throw new HttpError(502, 'PEXELS_INVALID_KEY', 'The configured Pexels API key is invalid');
  if (res.status === 429) throw new HttpError(429, 'PEXELS_RATE_LIMITED', 'Pexels rate limit reached, try again later');
  if (!res.ok) throw new HttpError(502, 'PEXELS_ERROR', `Pexels responded with HTTP ${res.status}`);
  return res.json();
}

const normalizePhoto = (p) => ({
  id: p.id,
  width: p.width,
  height: p.height,
  alt: p.alt || null,
  avgColor: p.avg_color || null,
  photographer: p.photographer,
  photographerUrl: p.photographer_url,
  pexelsUrl: p.url,
  src: p.src,
});

export async function searchPexels({ query, page, perPage, orientation, size, color }) {
  const data = await pexelsSearch({ query, page, per_page: perPage, orientation, size, color });
  return {
    query,
    page: data.page,
    perPage: data.per_page,
    totalResults: data.total_results,
    hasNextPage: Boolean(data.next_page),
    photos: (data.photos || []).map(normalizePhoto),
  };
}

// Job runner: collects `count` photos across result pages, then downloads them in parallel.
export async function runPexelsDownload(ctx, { query, count, quality, orientation, size, color }) {
  const photos = [];
  const seen = new Set();
  for (let page = 1; photos.length < count && !ctx.signal.aborted; page++) {
    const data = await pexelsSearch({ query, page, per_page: PAGE_SIZE, orientation, size, color }, ctx.signal);
    for (const p of data.photos || []) {
      if (photos.length < count && !seen.has(p.id)) {
        seen.add(p.id);
        photos.push(p);
      }
    }
    if (!data.photos?.length || !data.next_page) break;
  }

  ctx.setItems(photos.map((p) => ({ url: p.src[quality] || p.src.original, label: p.alt || `Photo by ${p.photographer}`, preview: p.src.tiny })));
  if (!photos.length) ctx.setMessage(`No Pexels photos found for "${query}"`);
  else if (photos.length < count) ctx.setMessage(`Only ${photos.length} of ${count} requested photos were available`);

  const base = sanitizeName(query);
  await runPool(photos, config.downloadConcurrency, async (p, i) => {
    const url = p.src[quality] || p.src.original;
    ctx.itemStarted(i);
    try {
      const file = await downloadImage(url, ctx.albumDir, `${base}_${i + 1}`, { signal: ctx.signal });
      ctx.addFile(file, {
        sourceUrl: url,
        pexelsId: p.id,
        photographer: p.photographer,
        photographerUrl: p.photographer_url,
        pexelsUrl: p.url,
        alt: p.alt || null,
        width: p.width,
        height: p.height,
      }, i);
    } catch (err) {
      ctx.addError(url, err, i);
    }
  }, ctx.signal);
}
