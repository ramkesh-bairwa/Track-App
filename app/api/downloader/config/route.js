// Phase 1 — Foundation: the options the UI should offer the user.
import { NextResponse } from 'next/server';
import { config, getPexelsApiKey } from '@/lib/downloader/config';
import { downloaderRoute } from '@/lib/downloader/errors';
import { allowedRoots } from '@/lib/downloader/savePath';
import { PEXELS_ORIENTATIONS, PEXELS_QUALITIES, PEXELS_SIZES } from '@/lib/downloader/pexels';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async () =>
  NextResponse.json({
    authRequired: true,
    pexels: {
      configured: Boolean(getPexelsApiKey()),
      maxCount: config.maxPexelsCount,
      qualities: Object.entries(PEXELS_QUALITIES).map(([key, label]) => ({ key, label })),
      defaultQuality: 'original',
      orientations: PEXELS_ORIENTATIONS,
      sizes: PEXELS_SIZES,
    },
    webpage: { maxImages: config.maxWebpageImages },
    // Where images go when no "Save to" folder is given, and where one may point.
    save: { defaultDir: config.downloadRoot, allowedRoots: allowedRoots() },
    limits: { maxImageBytes: config.maxImageBytes, downloadConcurrency: config.downloadConcurrency },
  })
);
