import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { dayCounts, deleteAll, requireAdmin, shotOwner, trackerStatus } from '@/lib/screenshots';

// One account's screenshot count per day, and how the tracker's last run went.
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [days, status] = await Promise.all([dayCounts(owner), trackerStatus(owner)]);
  return NextResponse.json({ user: owner, days, status });
});

// Deletes every screenshot the account has.
export const DELETE = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteAll(owner);
  return NextResponse.json({ ok: true });
});
