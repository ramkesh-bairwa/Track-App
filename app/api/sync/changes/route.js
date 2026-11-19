import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireSyncKey } from '@/lib/syncAuth';
import { exportChanges } from '@/lib/sync';

// Everything that changed here since ?since=<this install's time> (all of it
// when absent), for the other install to merge.
export const GET = withApiErrors(async (request) => {
  const { error } = await requireSyncKey(request);
  if (error) return error;
  const since = new URL(request.url).searchParams.get('since') || null;
  if (since && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(since)) {
    return NextResponse.json({ error: 'Bad "since" time.' }, { status: 400 });
  }
  return NextResponse.json(await exportChanges(since));
});
