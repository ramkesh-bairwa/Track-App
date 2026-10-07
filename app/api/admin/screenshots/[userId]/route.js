import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { dayCounts, deleteAll, isPaused, requireAdmin, setPaused, shotOwner, trackerStatus } from '@/lib/screenshots';

// One account's screenshot count per day, how the tracker's last run went, and
// whether screenshots are turned off.
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [days, status, paused] = await Promise.all([dayCounts(owner), trackerStatus(owner), isPaused(owner)]);
  return NextResponse.json({ user: owner, days, status, paused });
});

// Turns screenshots off ({ paused: true }) or back on ({ paused: false }).
export const PATCH = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.paused !== 'boolean') return NextResponse.json({ error: 'paused must be true or false.' }, { status: 400 });
  await setPaused(owner, body.paused);
  return NextResponse.json({ paused: body.paused });
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
