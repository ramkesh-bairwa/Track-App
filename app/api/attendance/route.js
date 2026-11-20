import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { openEntry, checkIn, checkOut, listAttendance, groupByDay } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

// The signed-in user's own check-in status, recent sessions and per-day totals.
// ?days=N (default 30) sets how far back the list and timesheet go.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Math.min(366, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const from = new Date(Date.now() - days * 86400000);
  const rows = await listAttendance(user.id, { from });
  const open = await openEntry(user.id);
  return NextResponse.json({ open, rows, days: groupByDay(rows) });
});

// { action: 'in' | 'out', note? } — check in or check out.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.action === 'in') {
    const r = await checkIn(user.id, typeof body.note === 'string' ? body.note.slice(0, 500) : null);
    if (r.already) return NextResponse.json({ error: 'You are already checked in.' }, { status: 400 });
    return NextResponse.json({ ok: true, checkedIn: true });
  }
  if (body.action === 'out') {
    const r = await checkOut(user.id);
    if (r.none) return NextResponse.json({ error: 'You are not checked in.' }, { status: 400 });
    return NextResponse.json({ ok: true, checkedIn: false });
  }
  return NextResponse.json({ error: 'Say action: "in" or "out".' }, { status: 400 });
});
