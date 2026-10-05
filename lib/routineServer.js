// Daily Routine: validation and the SELECT list shared by the API routes.
import { query } from './db';

export const ROUTINE_COLUMNS = `id, title, TIME_FORMAT(time_of_day, '%H:%i') AS time_of_day, days,
  DATE_FORMAT(created_at, '%Y-%m-%d') AS created_on`;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// days: ISO weekday digits, 1 = Monday … 7 = Sunday, e.g. '12345' for weekdays.
export function parseRoutineItem(body) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 255) : '';
  if (!title) return { error: 'Name the routine item.' };
  const time = body.time_of_day || null;
  if (time && !TIME.test(time)) return { error: 'Times must look like 06:30.' };
  const days = [...new Set(String(body.days ?? '').split(''))].filter((d) => /^[1-7]$/.test(d)).sort().join('');
  if (!days) return { error: 'Pick at least one day.' };
  return { value: { title, time_of_day: time, days } };
}

export async function ownRoutineItem(id, user) {
  const rows = await query(`SELECT ${ROUTINE_COLUMNS} FROM routine_items WHERE id = ? AND user_id = ?`, [Number(id) || 0, user.id]);
  return rows[0] || null;
}
