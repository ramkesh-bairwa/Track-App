import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireSyncKey, instanceId } from '@/lib/syncAuth';

// "Test connection" from the other install.
export const GET = withApiErrors(async (request) => {
  const { email, error } = await requireSyncKey(request);
  if (error) return error;
  return NextResponse.json({
    ok: true,
    instance: await instanceId(),
    kind: process.env.MYTRACK_DESKTOP === '1' ? 'desktop' : 'web',
    keyOwner: email,
  });
});
