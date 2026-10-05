import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { buildCodeZip, uploadFileToDrive } from '@/lib/backup';

export const POST = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await query('SELECT google_refresh_token FROM users WHERE id = ?', [user.id]);
    const refreshToken = rows[0]?.google_refresh_token;
    const buffer = await buildCodeZip();
    const filename = `mytrack-code-${new Date().toISOString().slice(0, 10)}.zip`;
    const uploaded = await uploadFileToDrive({ buffer, filename, mimeType: 'application/zip', refreshToken });
    return NextResponse.json({ ok: true, filename: uploaded.name || filename, link: uploaded.webViewLink });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
