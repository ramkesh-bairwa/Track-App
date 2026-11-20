import { query } from './db';

// The user's currently-open check-in (no check_out yet), or null.
export async function openEntry(userId) {
  const rows = await query(
    'SELECT id, check_in, note FROM attendance WHERE user_id = ? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

// Start a shift. Returns { already } when one is already open (no double check-in).
export async function checkIn(userId, note = null) {
  const open = await openEntry(userId);
  if (open) return { already: true, entry: open };
  const res = await query('INSERT INTO attendance (user_id, check_in, note) VALUES (?, NOW(), ?)', [userId, note || null]);
  return { id: res.insertId };
}

// End the open shift. Returns { none } when nothing is open.
export async function checkOut(userId) {
  const open = await openEntry(userId);
  if (!open) return { none: true };
  await query('UPDATE attendance SET check_out = NOW() WHERE id = ? AND check_out IS NULL', [open.id]);
  return { id: open.id };
}

// A user's rows in a date range (newest first). Dates are inclusive.
export async function listAttendance(userId, { from, to, limit = 500 } = {}) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (from) { where.push('check_in >= ?'); args.push(from); }
  if (to) { where.push('check_in < ?'); args.push(to); }
  return query(
    `SELECT id, check_in, check_out, note,
            TIMESTAMPDIFF(SECOND, check_in, COALESCE(check_out, NOW())) AS seconds
       FROM attendance WHERE ${where.join(' AND ')} ORDER BY check_in DESC LIMIT ${Number(limit)}`,
    args
  );
}

// Group rows into per-day totals for the timesheet: [{ date, seconds, sessions }].
export function groupByDay(rows) {
  const by = new Map();
  for (const r of rows) {
    const date = new Date(r.check_in);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const cur = by.get(key) || { date: key, seconds: 0, sessions: 0, open: false };
    cur.seconds += Number(r.seconds) || 0;
    cur.sessions += 1;
    if (!r.check_out) cur.open = true;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
