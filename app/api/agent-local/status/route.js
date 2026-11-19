import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { agentStatus } from '@/lib/agentClient';

export const dynamic = 'force-dynamic';

// Desktop app only: is this computer linked to a server, and how is it going.
export const GET = withApiErrors(async () => {
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ desktop: false });
  if (!(await getCurrentUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ desktop: true, ...(await agentStatus()) });
});
