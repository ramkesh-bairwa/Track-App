import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const columnRows = await query('SELECT id FROM track_columns WHERE track_id = ?', [trackId]);
  const validIds = new Set(columnRows.map((r) => r.id));

  function sanitizeIds(list) {
    if (!Array.isArray(list)) return null;
    return list.map((v) => Number(v)).filter((id) => validIds.has(id));
  }

  const filterableIds = sanitizeIds(body.filterable_column_ids);
  const searchableIds = sanitizeIds(body.searchable_column_ids);
  const pageSize =
    typeof body.page_size === 'number' && Number.isFinite(body.page_size)
      ? Math.min(200, Math.max(5, Math.round(body.page_size)))
      : null;

  const showSerial = typeof body.show_serial === 'boolean' ? (body.show_serial ? 1 : 0) : null;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (pageSize !== null) {
      await conn.execute('UPDATE tracks SET page_size = ? WHERE id = ?', [pageSize, trackId]);
    }

    if (showSerial !== null) {
      await conn.execute('UPDATE tracks SET show_serial = ? WHERE id = ?', [showSerial, trackId]);
    }

    if (filterableIds !== null) {
      await conn.execute('UPDATE track_columns SET is_filterable = 0 WHERE track_id = ?', [trackId]);
      if (filterableIds.length > 0) {
        await conn.query(
          `UPDATE track_columns SET is_filterable = 1 WHERE track_id = ? AND id IN (${filterableIds.map(() => '?').join(',')})`,
          [trackId, ...filterableIds]
        );
      }
    }

    if (searchableIds !== null) {
      await conn.execute('UPDATE track_columns SET is_searchable = 0 WHERE track_id = ?', [trackId]);
      if (searchableIds.length > 0) {
        await conn.query(
          `UPDATE track_columns SET is_searchable = 1 WHERE track_id = ? AND id IN (${searchableIds.map(() => '?').join(',')})`,
          [trackId, ...searchableIds]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    return NextResponse.json({ error: 'Could not save settings.' }, { status: 500 });
  } finally {
    conn.release();
  }

  const trackRows = await query('SELECT page_size, show_serial FROM tracks WHERE id = ?', [trackId]);
  const columns = await query(
    'SELECT * FROM track_columns WHERE track_id = ? ORDER BY position ASC, id ASC',
    [trackId]
  );
  return NextResponse.json({ page_size: trackRows[0].page_size, show_serial: Boolean(trackRows[0].show_serial), columns });
});
