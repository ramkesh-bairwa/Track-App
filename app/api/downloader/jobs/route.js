// Phase 4 — recent jobs, newest first. ?status=running  ?type=pexels|webpage|url
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';
import { listJobs } from '@/lib/downloader/jobs';
import { oneOf } from '@/lib/downloader/validate';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request) => {
  const q = new URL(request.url).searchParams;
  const status = oneOf(q.get('status') || undefined, 'status', ['queued', 'running', 'completed', 'failed', 'cancelled']);
  const type = oneOf(q.get('type') || undefined, 'type', ['pexels', 'webpage', 'url']);
  return NextResponse.json({ jobs: listJobs({ status, type }) });
});
