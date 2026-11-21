import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { dayCounts, deleteAll, requireAdmin, shotOwner, trackerStatus, trackerSwitch, setTrackerSwitch } from '@/lib/screenshots';

// One account's screenshot count per day, how the tracker's last run went,
// and whether capturing is switched on.
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [days, status, power] = await Promise.all([dayCounts(owner), trackerStatus(owner), trackerSwitch(owner)]);
  return NextResponse.json({ user: owner, days, status, power });
});

// { enabled: true | false } switches capturing on or off for this account.
export const PATCH = withApiErrors(async (request, { params }) => {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Send enabled: true or false.' }, { status: 400 });
  const power = await setTrackerSwitch(owner, body.enabled, user.name);
  return NextResponse.json({ power });
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
