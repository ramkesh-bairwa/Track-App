import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { linkToServer, runTick, agentStatus } from '@/lib/agentClient';

export const dynamic = 'force-dynamic';

// Desktop app only: { serverUrl, email, password } — sign this computer in to
// the server (the password goes to the server only, never stored here), then
// sync straight away.
export const POST = withApiErrors(async (request) => {
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    await linkToServer({ serverUrl: body.serverUrl, email: String(body.email || '').trim(), password: String(body.password || '') });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const tick = await runTick({ reason: 'linked' });
  return NextResponse.json({ ...(await agentStatus()), tick });
});
