
export const LEAVE_TYPES = ['casual', 'sick', 'vacation', 'personal', 'holiday', 'other'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export function isDate(v) {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// SELECT lists that hand dates back as 'YYYY-MM-DD' strings — mysql2 would
// otherwise turn DATE columns into JS Dates at local midnight, which shift a
// day when serialised to JSON in any timezone east of UTC.
export const LEAVE_COLUMNS = `id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, leave_type, half_day, note`;
export const ACTIVITY_COLUMNS = `id, DATE_FORMAT(activity_date, '%Y-%m-%d') AS activity_date,
  TIME_FORMAT(start_time, '%H:%i') AS start_time, TIME_FORMAT(end_time, '%H:%i') AS end_time, title, details`;

// Validates a leave body. `partial` allows PATCH bodies that only send some fields.
export function parseLeave(body, partial = false) {
  const out = {};
  for (const key of ['start_date', 'end_date']) {
    if (body[key] === undefined && partial) continue;
    if (!isDate(body[key])) return { error: 'Pick a valid start and end date.' };
    out[key] = body[key];
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) {
    return { error: 'The end date is before the start date.' };
  }
  if (body.leave_type !== undefined || !partial) {
    out.leave_type = LEAVE_TYPES.includes(body.leave_type) ? body.leave_type : 'casual';
  }
  if (body.half_day !== undefined || !partial) out.half_day = body.half_day ? 1 : 0;
  if (body.note !== undefined || !partial) {
    out.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  }
  return { value: out };
}

export function parseActivity(body, partial = false) {
  const out = {};
  if (body.activity_date !== undefined || !partial) {
    if (!isDate(body.activity_date)) return { error: 'Pick a valid date.' };
    out.activity_date = body.activity_date;
  }
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 255) : '';
    if (!title) return { error: 'Say what you did.' };
    out.title = title;
  }
  for (const key of ['start_time', 'end_time']) {
    if (body[key] === undefined && partial) continue;
    const v = body[key];
    if (v && !TIME.test(v)) return { error: 'Times must look like 09:30.' };
    out[key] = v || null;
  }
  if (out.start_time && out.end_time && out.end_time < out.start_time) {
    return { error: 'The end time is before the start time.' };
  }
  if (body.details !== undefined || !partial) {
    out.details = typeof body.details === 'string' && body.details.trim() ? body.details.trim().slice(0, 20000) : null;
  }
  return { value: out };
}
