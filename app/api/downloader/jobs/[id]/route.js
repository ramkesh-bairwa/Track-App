// Phase 4 — one job in full: every saved file, error and per-image status.
import { NextResponse } from 'next/server';
import { downloaderRoute, notFound } from '@/lib/downloader/errors';
import { getJob } from '@/lib/downloader/jobs';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request, { params }) => {
  const job = getJob(params.id);
  if (!job) throw notFound(`Job "${params.id}" not found`);
  return NextResponse.json(job);
});
