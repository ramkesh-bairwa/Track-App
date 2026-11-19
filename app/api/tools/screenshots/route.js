import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { MAX_SHOT_BYTES, newToken, saveShot, sniffImage } from '@/lib/sharedShots';

export const dynamic = 'force-dynamic';

const publicRow = (r) => ({ token: r.token, name: r.name, mime: r.mime, size: r.size, width: r.width, height: r.height, created_at: r.created_at, url: `/api/shots/${r.token}` });

// The signed-in user's shared screenshots, newest first.
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await query('SELECT * FROM shared_screenshots WHERE user_id = ? ORDER BY id DESC LIMIT 200', [user.id]);
  return NextResponse.json({ shots: rows.map(publicRow) });
});

// Body: the image bytes. ?name=…&w=…&h=… → { url } that anyone with it can open.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: 'No image was sent.' }, { status: 400 });
  if (buf.length > MAX_SHOT_BYTES) return NextResponse.json({ error: 'The image is larger than 25 MB.' }, { status: 413 });
  const mime = sniffImage(buf);
  if (!mime) return NextResponse.json({ error: 'Only PNG, JPEG or WebP images can be shared.' }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const name = (params.get('name') || 'Screenshot').slice(0, 200);
  const dim = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const token = newToken();
  await saveShot(token, mime, buf);
  await query('INSERT INTO shared_screenshots (token, user_id, name, mime, size, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    token, user.id, name, mime, buf.length, dim(params.get('w')), dim(params.get('h')),
  ]);
  const [row] = await query('SELECT * FROM shared_screenshots WHERE token = ?', [token]);
  return NextResponse.json({ shot: publicRow(row) }, { status: 201 });
});
