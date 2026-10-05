import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { dumpDatabaseSql, uploadFileToDrive } from '@/lib/backup';

export const POST = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await query('SELECT google_refresh_token FROM users WHERE id = ?', [user.id]);
    const refreshToken = rows[0]?.google_refresh_token;
    const sql = await dumpDatabaseSql();
    const filename = `mytrack-db-${new Date().toISOString().slice(0, 10)}.sql`;
    const uploaded = await uploadFileToDrive({
      buffer: Buffer.from(sql, 'utf8'),
      filename,
      mimeType: 'application/sql',
      refreshToken,
    });
    return NextResponse.json({ ok: true, filename: uploaded.name || filename, link: uploaded.webViewLink });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
