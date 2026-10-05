// Phase 4 — stop a running job; images already saved are kept.
import { NextResponse } from 'next/server';
import { downloaderRoute, notFound } from '@/lib/downloader/errors';
import { cancelJob, getJob } from '@/lib/downloader/jobs';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request, { params }) => {
  const job = getJob(params.id);
  if (!job) throw notFound(`Job "${params.id}" not found`);
  cancelJob(job);
  return NextResponse.json(job.summary());
});
