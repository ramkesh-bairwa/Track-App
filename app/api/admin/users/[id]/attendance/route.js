import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';
import { listAttendance, groupByDay, openEntry } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

// One user's attendance for an admin to review. ?days=N (default 30).
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  const days = Math.min(366, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const from = new Date(Date.now() - days * 86400000);
  const rows = await listAttendance(id, { from });
  const open = await openEntry(id);
  return NextResponse.json({ open, rows, days: groupByDay(rows) });
});
