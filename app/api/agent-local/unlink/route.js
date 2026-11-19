import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { unlinkFromServer, agentStatus } from '@/lib/agentClient';

export const dynamic = 'force-dynamic';

// Desktop app only: stop syncing with the server (data here stays).
export const POST = withApiErrors(async () => {
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await unlinkFromServer();
  return NextResponse.json(await agentStatus());
});
