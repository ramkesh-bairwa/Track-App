import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { deleteShots, requireAdmin, shotOwner, shotPath } from '@/lib/screenshots';

// Streams one screenshot. The date and file name are pattern-checked, so
// nothing outside the account's screenshot folder can be requested.
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  const file = owner && shotPath(owner, params.date, params.file);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    return new NextResponse(await fs.readFile(file), {
      headers: {
        'Content-Type': /\.png$/i.test(params.file) ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const owner = await shotOwner(params.userId);
  if (!owner || !shotPath(owner, params.date, params.file)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteShots(owner, params.date, [params.file]);
  return NextResponse.json({ ok: true });
});
