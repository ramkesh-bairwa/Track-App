// Phase 1 — Foundation: public health check.
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(
  async () => NextResponse.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() }),
  { isPublic: true }
);
