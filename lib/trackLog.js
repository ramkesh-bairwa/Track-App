// Track history: every change to a track, its sub-tracks, columns and
// records, kept per track in track_activity (like task_activity for task
// boards). Each record change lists the fields that changed, before and after:
// { key, label, type, old, new, oldText, newText } — raw values (for revert)
// plus display text captured at the time of the change.
import { query } from './db';
import { fieldTypeMeta, formatDisplayValue, optionList } from './fieldTypes';

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const isBlank = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

export function parseData(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value || '{}') || {};
  } catch {
    return {};
  }
}

function fileText(value) {
  const m = /^data:([\w.+-]+\/[\w.+-]+)/i.exec(String(value || ''));
  const kb = Math.round((String(value).length * 3) / 4 / 1024);
  return `File (${m ? m[1] : 'unknown type'}, ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`})`;
}

// How a value reads in the log. Files are summarised (they can be megabytes).
export function displayText(column, value) {
  if (isBlank(value)) return '';
  const meta = fieldTypeMeta(column.field_type);
  if (meta.input === 'checkbox') return value === true || value === 'true' || value === 1 ? 'Yes' : 'No';
  if (meta.input === 'file') return fileText(value);
  if (meta.input === 'multiselect') return optionList(value).join(', ');
  if (typeof value === 'object') return clip(JSON.stringify(value), 500);
  return clip(formatDisplayValue(column, value), 500);
}

const sameValue = (a, b) => (isBlank(a) && isBlank(b)) || JSON.stringify(a) === JSON.stringify(b);

function change(column, before, after) {
  const file = fieldTypeMeta(column.field_type).input === 'file';
  return {
    key: column.field_key,
    label: column.label,
    type: column.field_type,
    // Files aren't copied into the log (size); they can't be reverted.
    old: file ? null : before ?? null,
    new: file ? null : after ?? null,
    oldText: displayText(column, before),
    newText: displayText(column, after),
  };
}

// Field-by-field differences between two versions of a record's data.
export function diffEntry(columns, before, after) {
  const out = [];
  for (const col of columns) {
    if (col.is_auto_increment) continue;
    const a = before?.[col.field_key];
    const b = after?.[col.field_key];
    if (!sameValue(a, b)) out.push(change(col, a, b));
  }
  return out;
}

// What a new record started with (non-empty fields only).
export function entryFacts(columns, data) {
  return columns
    .filter((c) => !c.is_auto_increment && !isBlank(data?.[c.field_key]))
    .map((c) => change(c, undefined, data[c.field_key]));
}

// A short name for a record in the log: its first filled-in plain field.
export function entryLabel(columns, data) {
  for (const col of columns) {
    const input = fieldTypeMeta(col.field_type).input;
    if (col.is_auto_increment || ['password', 'file', 'checkbox', 'color'].includes(input)) continue;
    const text = displayText(col, data?.[col.field_key]);
    if (text) return clip(text, 80);
  }
  return '';
}

export async function trackColumns(trackId) {
  return query('SELECT * FROM track_columns WHERE track_id = ? ORDER BY position ASC, id ASC', [trackId]);
}

export async function logTrack({
  trackId,
  user,
  action,
  summary,
  entry = null, // { id, uuid, label }
  changes = null,
  snapshot = null,
  revertOf = null,
  trackName = null, // used when the track row is already gone
}) {
  if (!trackId) return null;
  try {
    const owner = (await query('SELECT user_id, name FROM tracks WHERE id = ?', [trackId]))[0];
    const res = await query(
      `INSERT INTO track_activity
         (track_id, owner_id, track_name, entry_id, entry_uuid, entry_label, user_id, user_name, action, summary, changes, snapshot, revert_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trackId,
        owner?.user_id ?? user?.id ?? null,
        clip(owner?.name ?? trackName ?? '', 255) || null,
        entry?.id ?? null,
        entry?.uuid ?? null,
        entry?.label ? clip(entry.label, 255) : null,
        user?.id ?? null,
        user?.name ? clip(user.name, 255) : null,
        clip(action, 30),
        clip(summary, 500),
        changes && changes.length ? JSON.stringify(changes) : null,
        snapshot ? JSON.stringify(snapshot) : null,
        revertOf,
      ]
    );
    return res.insertId;
  } catch (err) {
    // The log must never block the change itself (e.g. schema not migrated yet).
    console.error('track log failed:', err.message);
    return null;
  }
}

// A simple property change on a track: { key, label, oldText, newText }.
export function propChange(key, label, before, after) {
  return { key, label, old: before ?? null, new: after ?? null, oldText: clip(before ?? '', 500), newText: clip(after ?? '', 500) };
}

const parseJson = (v, fallback) => {
  if (v && typeof v === 'object') return v;
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

// History lines for the browser. `where` is an SQL condition on `a`
// (track_activity). Lines of deleted tracks are kept (track_exists = false).
export async function listTrackActivity(where, args, limit = 3000) {
  const rows = await query(
    `SELECT a.*, t.name AS live_track_name, t.uuid AS track_uuid, (t.id IS NOT NULL) AS track_exists,
            e.is_locked AS entry_locked, (e.id IS NOT NULL) AS entry_exists,
            nb.name AS note_by_name, rb.name AS reverted_by_name, u.avatar AS user_avatar
       FROM track_activity a
       LEFT JOIN tracks t ON t.id = a.track_id
       LEFT JOIN track_entries e ON e.id = a.entry_id
       LEFT JOIN users nb ON nb.id = a.note_by
       LEFT JOIN users rb ON rb.id = a.reverted_by
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT ${Number(limit) || 3000}`,
    args
  );
  return rows.map((r) => {
    const snapshot = parseJson(r.snapshot, null);
    const trackExists = Boolean(r.track_exists);
    // A locked record's values stay hidden in its history too, until unlocked.
    const hidden = Boolean(r.entry_locked) || Boolean(!r.entry_exists && snapshot?.is_locked);
    const changes = parseJson(r.changes, []);
    return {
      id: r.id,
      track_id: r.track_id,
      track_name: r.live_track_name || r.track_name || 'Deleted track',
      track_uuid: trackExists ? r.track_uuid : null,
      track_exists: trackExists,
      entry_id: r.entry_id,
      entry_uuid: r.entry_uuid,
      entry_label: hidden ? '' : r.entry_label,
      entry_exists: Boolean(r.entry_exists),
      user_id: r.user_id,
      user_name: r.user_name,
      user_avatar: r.user_avatar,
      action: r.action,
      summary: hidden && r.entry_label ? r.summary.replace(` “${r.entry_label}”`, ' (locked)') : r.summary,
      hidden,
      changes: hidden ? [] : changes.map(({ old, new: _new, ...c }) => c),
      revertible:
        trackExists &&
        !r.reverted_at &&
        !hidden &&
        ((r.action === 'entry_update' && r.entry_exists && changes.some((c) => c.old !== undefined && !(c.old === null && c.new === null))) ||
          (r.action === 'entry_delete' && !r.entry_exists && Boolean(snapshot))),
      revert_of: r.revert_of,
      reverted_at: r.reverted_at,
      reverted_by_name: r.reverted_by_name,
      note: r.note,
      note_by_name: r.note_by_name,
      note_at: r.note_at,
      created_at: r.created_at,
    };
  });
}
