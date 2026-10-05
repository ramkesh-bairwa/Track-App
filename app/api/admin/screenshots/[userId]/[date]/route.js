import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { isDate } from '@/lib/calendarServer';
import { deleteDay, deleteShots, listShotMeta, listShots, requireAdmin, shotOwner } from '@/lib/screenshots';

async function load(params) {
  const { error } = await requireAdmin();
  if (error) return { error };
  const owner = await shotOwner(params.userId);
  if (!owner || !isDate(params.date)) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { owner };
}

// One account's screenshot file names for one day, with each capture's app and window title.
export const GET = withApiErrors(async (request, { params }) => {
  const { owner, error } = await load(params);
  if (error) return error;
  const [files, meta] = await Promise.all([listShots(owner, params.date), listShotMeta(owner, params.date)]);
  return NextResponse.json({ files, meta });
});

// Body { files: [...] } deletes those files; no body deletes the whole day.
export const DELETE = withApiErrors(async (request, { params }) => {
  const { owner, error } = await load(params);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body.files)) {
    return NextResponse.json({ ok: true, deleted: await deleteShots(owner, params.date, body.files) });
  }
  await deleteDay(owner, params.date);
  return NextResponse.json({ ok: true });
});
