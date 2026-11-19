import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isLocalRequest } from '@/lib/systemEvents';
import { runTick } from '@/lib/agentClient';

export const dynamic = 'force-dynamic';

// Desktop app only. Called every minute by desktop/main.js (with its launch
// secret), or by "Sync now" in Server connection (signed in).
export const POST = withApiErrors(async (request) => {
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const local = isLocalRequest(request);
  if (!local && !(await getCurrentUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await runTick({ reason: local ? 'timer' : 'manual' }));
});
