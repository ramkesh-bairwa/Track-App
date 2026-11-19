import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { isToken, shotPath } from '@/lib/sharedShots';

export const dynamic = 'force-dynamic';

// A shared screenshot. No sign-in: the unguessable token is the permission.
export async function GET(request, { params }) {
  const notFound = () => new NextResponse('Not found', { status: 404 });
  if (!isToken(params.token)) return notFound();
  try {
    const [row] = await query('SELECT token, mime, name FROM shared_screenshots WHERE token = ?', [params.token]);
    if (!row) return notFound();
    const body = await fs.readFile(shotPath(row.token, row.mime));
    const download = new URL(request.url).searchParams.has('download');
    const ext = row.mime === 'image/jpeg' ? 'jpg' : row.mime.split('/')[1];
    const file = `${String(row.name || 'screenshot').replace(/[^\w.\- ]+/g, '').trim() || 'screenshot'}.${ext}`;
    return new NextResponse(body, {
      headers: {
        'Content-Type': row.mime,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file}"`,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch {
    return notFound();
  }
}
