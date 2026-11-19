import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { listTrackActivity } from '@/lib/trackLog';

// GET — the history of all your tracks and sub-tracks, deleted ones included.
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const activity = await listTrackActivity('a.owner_id = ?', [user.id]);
  return NextResponse.json({ activity, me: user.id });
});
