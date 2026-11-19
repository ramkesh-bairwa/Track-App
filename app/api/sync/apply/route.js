import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireSyncKey } from '@/lib/syncAuth';
import { applyChanges } from '@/lib/sync';

// The other install's changes, merged in here (newer change wins).
export const POST = withApiErrors(async (request) => {
  const { error } = await requireSyncKey(request);
  if (error) return error;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Send the changes as JSON.' }, { status: 400 });
  const { stats } = await applyChanges(payload);
  return NextResponse.json({ ok: true, stats });
});
