// Automatic activity log: every successful change a user makes through the
// API becomes one readable line ("Edited note “Plan”"). Hooked into the two
// route wrappers (lib/apiError.js withApiErrors, lib/downloader/errors.js),
// so routes don't call it themselves. Task-board actions are not logged here
// — they already live in task_activity, which listActivity() merges in.
import { query } from './db';
import { SESSION_COOKIE, verifySessionToken } from './auth';

const MERGE_WINDOW_MIN = 30; // repeats of the same action on the same thing merge into one line
const clip = (s, n = 80) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const q = (s) => `“${clip(s) || 'untitled'}”`;
const one = async (sql, args) => (await query(sql, args))[0] || null;

// ---------- name lookups (run before the handler, so deletes still have a name) ----------
const trackOf = (id, uid) => one('SELECT id, uuid, name FROM tracks WHERE id = ? AND user_id = ?', [id, uid]);
const noteOf = (id, uid) => one('SELECT id, uuid, title FROM notes WHERE id = ? AND user_id = ?', [id, uid]);
const codeOf = (uuid, uid) => one('SELECT uuid, name FROM code_snippets WHERE uuid = ? AND user_id = ?', [uuid, uid]);
const personOf = (id) => one('SELECT id, name, email FROM users WHERE id = ?', [id]);
const leaveOf = (id, uid) =>
  one("SELECT DATE_FORMAT(start_date, '%d %b') AS s, DATE_FORMAT(end_date, '%d %b') AS e, leave_type FROM calendar_leaves WHERE id = ? AND user_id = ?", [id, uid]);
const expenseOf = (id, uid) => one('SELECT description, CAST(amount AS DOUBLE) AS amount FROM expenses WHERE id = ? AND user_id = ?', [id, uid]);
const routineOf = (id, uid) => one('SELECT title FROM routine_items WHERE id = ? AND user_id = ?', [id, uid]);
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const trackUrl = (t) => (t?.uuid ? `/dashboard/tracks/${t.uuid}` : null);

// ---------- rules: method + path → what to record ----------
// `before(c)` (optional) runs before the route and can look things up;
// `log(c)` runs after a 2xx/3xx response and returns the line, or null to skip.
// c = { m: path match, body: request JSON, res: response JSON, uid, pre: before() result }
const R = (method, re, log, before) => ({ method, re, log, before });
const RULES = [
  // Account
  R('POST', /^\/api\/auth\/login$/, () => ({ kind: 'account', action: 'signin', summary: 'Signed in' })),
  R('POST', /^\/api\/auth\/logout$/, () => ({ kind: 'account', action: 'signout', summary: 'Signed out' })),
  R('POST', /^\/api\/auth\/register$/, () => ({ kind: 'account', action: 'created', summary: 'Created your MyTrack account' })),
  R('PATCH', /^\/api\/auth\/me$/, (c) => ({ kind: 'account', action: 'edited', summary: c.body?.newPassword ? 'Changed your password' : 'Updated your profile', ref: 'profile' })),
  R('PATCH', /^\/api\/auth\/privacy$/, () => ({ kind: 'account', action: 'edited', summary: 'Changed privacy settings', ref: 'privacy' })),
  R('PATCH', /^\/api\/auth\/appearance$/, () => ({ kind: 'account', action: 'edited', summary: 'Changed sidebar / topbar colours', ref: 'appearance' })),
  R('POST', /^\/api\/backup\/code$/, () => ({ kind: 'backup', action: 'created', summary: 'Backed up the source code to Google Drive' })),
  R('POST', /^\/api\/backup\/database$/, () => ({ kind: 'backup', action: 'created', summary: 'Backed up the database' })),

  // Users
  R('POST', /^\/api\/users$/, (c) => ({ kind: 'user', action: 'created', summary: `Created a user account for ${q(c.body?.name || c.body?.email)}`, url: '/dashboard/users' })),
  R('PATCH', /^\/api\/(?:admin\/)?users\/(\d+)$/, (c) => ({ kind: 'user', action: 'edited', summary: `Edited user ${q(c.pre?.name || c.pre?.email)}`, url: '/dashboard/users', ref: `user:${c.m[1]}` }), (c) => personOf(c.m[1])),

  // Tracks & entries
  R('POST', /^\/api\/tracks$/, (c) => ({ kind: 'track', action: 'created', summary: `Created track ${q(c.body?.name)}`, url: c.res?.trackUuid ? `/dashboard/tracks/${c.res.trackUuid}` : null, ref: `track:${c.res?.trackId}` })),
  R('PATCH', /^\/api\/tracks\/(\d+)$/, (c) => ({ kind: 'track', action: 'edited', summary: `Edited track ${q(c.body?.name || c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}` }), (c) => trackOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/tracks\/(\d+)$/, (c) => ({ kind: 'track', action: 'deleted', summary: `Deleted track ${q(c.pre?.name)}` }), (c) => trackOf(c.m[1], c.uid)),
  R('PATCH', /^\/api\/tracks\/(\d+)\/settings$/, (c) => ({ kind: 'track', action: 'edited', summary: `Changed settings of ${q(c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}:settings` }), (c) => trackOf(c.m[1], c.uid)),
  R('POST', /^\/api\/tracks\/(\d+)\/columns$/, (c) => ({ kind: 'track', action: 'edited', summary: `Added a column${c.body?.label ? ` ${q(c.body.label)}` : ''} to ${q(c.pre?.name)}`, url: trackUrl(c.pre) }), (c) => trackOf(c.m[1], c.uid)),
  R('PATCH', /^\/api\/tracks\/(\d+)\/columns(?:\/\d+)?$/, (c) => ({ kind: 'track', action: 'edited', summary: `Edited columns of ${q(c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}:columns` }), (c) => trackOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/tracks\/(\d+)\/columns\/\d+$/, (c) => ({ kind: 'track', action: 'edited', summary: `Removed a column from ${q(c.pre?.name)}`, url: trackUrl(c.pre) }), (c) => trackOf(c.m[1], c.uid)),
  R('POST', /^\/api\/tracks\/(\d+)\/entries$/, (c) => ({ kind: 'entry', action: 'created', summary: `Added an entry to ${q(c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}:entry-add` }), (c) => trackOf(c.m[1], c.uid)),
  R('PATCH', /^\/api\/tracks\/(\d+)\/entries(?:\/\d+)?$/, (c) => ({ kind: 'entry', action: 'edited', summary: `Edited entries in ${q(c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}:entry-edit` }), (c) => trackOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/tracks\/(\d+)\/entries\/\d+$/, (c) => ({ kind: 'entry', action: 'deleted', summary: `Deleted an entry from ${q(c.pre?.name)}`, url: trackUrl(c.pre), ref: `track:${c.m[1]}:entry-del` }), (c) => trackOf(c.m[1], c.uid)),

  // Notes
  R('POST', /^\/api\/notes$/, (c) => ({ kind: 'note', action: 'created', summary: `Created note ${q(c.body?.title)}`, url: c.res?.noteUuid ? `/dashboard/notes/${c.res.noteUuid}` : null, ref: `note:${c.res?.noteId}` })),
  R('PATCH', /^\/api\/notes\/(\d+)$/, (c) => ({ kind: 'note', action: 'edited', summary: `Edited note ${q(c.body?.title || c.pre?.title)}`, url: c.pre?.uuid ? `/dashboard/notes/${c.pre.uuid}` : null, ref: `note:${c.m[1]}` }), (c) => noteOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/notes\/(\d+)$/, (c) => ({ kind: 'note', action: 'deleted', summary: `Deleted note ${q(c.pre?.title)}` }), (c) => noteOf(c.m[1], c.uid)),

  // Code
  R('POST', /^\/api\/code$/, (c) => ({ kind: 'code', action: 'created', summary: `Created code file ${q(c.body?.name)}`, url: c.res?.uuid ? `/dashboard/code/${c.res.uuid}` : null, ref: `code:${c.res?.uuid}` })),
  R('PATCH', /^\/api\/code\/([\w-]+)$/, (c) => ({ kind: 'code', action: 'edited', summary: `Edited code file ${q(c.body?.name || c.pre?.name)}`, url: `/dashboard/code/${c.m[1]}`, ref: `code:${c.m[1]}` }), (c) => codeOf(c.m[1], c.uid)),
  R('POST', /^\/api\/code\/([\w-]+)\/versions$/, (c) => ({ kind: 'code', action: 'saved', summary: `Saved a version of ${q(c.pre?.name)}${c.body?.label ? ` (${clip(c.body.label, 40)})` : ''}`, url: `/dashboard/code/${c.m[1]}` }), (c) => codeOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/code\/([\w-]+)$/, (c) => ({ kind: 'code', action: 'deleted', summary: `Deleted code file ${q(c.pre?.name)}` }), (c) => codeOf(c.m[1], c.uid)),

  // Daily expenses and routine (ticking routine items off isn't logged — the routine page is its own record)
  R('POST', /^\/api\/expenses$/, (c) => ({ kind: 'expense', action: 'created', summary: `Spent ${rupees(c.body?.amount)} on ${q(c.body?.description)}`, url: '/dashboard/expenses', ref: `expense:${c.res?.id}` })),
  R('PATCH', /^\/api\/expenses\/(\d+)$/, (c) => ({ kind: 'expense', action: 'edited', summary: `Edited expense ${q(c.body?.description || c.pre?.description)}`, url: '/dashboard/expenses', ref: `expense:${c.m[1]}` }), (c) => expenseOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/expenses\/(\d+)$/, (c) => ({ kind: 'expense', action: 'deleted', summary: `Deleted expense ${q(c.pre?.description)}${c.pre ? ` (${rupees(c.pre.amount)})` : ''}`, url: '/dashboard/expenses' }), (c) => expenseOf(c.m[1], c.uid)),
  R('POST', /^\/api\/routine$/, (c) => ({ kind: 'routine', action: 'created', summary: `Added ${q(c.body?.title)} to your routine`, url: '/dashboard/routine', ref: `routine:${c.res?.id}` })),
  R('PATCH', /^\/api\/routine\/(\d+)$/, (c) => ({ kind: 'routine', action: 'edited', summary: `Edited routine item ${q(c.body?.title || c.pre?.title)}`, url: '/dashboard/routine', ref: `routine:${c.m[1]}` }), (c) => routineOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/routine\/(\d+)$/, (c) => ({ kind: 'routine', action: 'deleted', summary: `Removed ${q(c.pre?.title)} from your routine`, url: '/dashboard/routine' }), (c) => routineOf(c.m[1], c.uid)),
  // Calendar (the manual "What I did" log is already the calendar's own content)
  R('POST', /^\/api\/calendar\/leaves$/, (c) => ({ kind: 'calendar', action: 'created', summary: `Marked ${c.body?.leave_type || 'casual'} leave ${c.body?.start_date === c.body?.end_date ? c.body?.start_date : `${c.body?.start_date} → ${c.body?.end_date}`}`, url: '/dashboard/calendar' })),
  R('PATCH', /^\/api\/calendar\/leaves\/(\d+)$/, (c) => ({ kind: 'calendar', action: 'edited', summary: `Changed leave ${c.pre ? `${c.pre.s}–${c.pre.e}` : ''}`.trim(), url: '/dashboard/calendar', ref: `leave:${c.m[1]}` }), (c) => leaveOf(c.m[1], c.uid)),
  R('DELETE', /^\/api\/calendar\/leaves\/(\d+)$/, (c) => ({ kind: 'calendar', action: 'deleted', summary: `Removed leave ${c.pre ? `${c.pre.s}–${c.pre.e}` : ''}`.trim(), url: '/dashboard/calendar' }), (c) => leaveOf(c.m[1], c.uid)),

  // Image downloader
  R('POST', /^\/api\/downloader\/pexels\/download$/, (c) => ({ kind: 'download', action: 'created', summary: `Downloaded ${c.body?.count || ''} Pexels photo${Number(c.body?.count) === 1 ? '' : 's'} of ${q(c.body?.query)}`.replace('  ', ' '), url: '/dashboard/downloader' })),
  R('POST', /^\/api\/downloader\/urls\/download$/, (c) => {
    const n = Array.isArray(c.body?.urls) ? c.body.urls.length : String(c.body?.urls || '').split(/\s+/).filter(Boolean).length;
    return { kind: 'download', action: 'created', summary: `Downloaded ${n} image${n === 1 ? '' : 's'} from URLs${c.body?.albumName ? ` (${clip(c.body.albumName, 40)})` : ''}`, url: '/dashboard/downloader' };
  }),
  R('POST', /^\/api\/downloader\/webpage\/download$/, (c) => ({ kind: 'download', action: 'created', summary: `Downloaded images from ${c.body?.url ? clip(new URL(c.body.url).hostname, 60) : 'a web page'}`, url: '/dashboard/downloader' })),
  R('DELETE', /^\/api\/downloader\/albums\/[^/]+$/, () => ({ kind: 'download', action: 'deleted', summary: 'Deleted a downloaded album', url: '/dashboard/downloader' })),
  R('DELETE', /^\/api\/downloader\/albums\/[^/]+\/images\/[^/]+$/, () => ({ kind: 'download', action: 'deleted', summary: 'Deleted downloaded images', url: '/dashboard/downloader', ref: 'download:image-delete' })),

  // Admin screenshots
  R('DELETE', /^\/api\/admin\/screenshots\/.+$/, () => ({ kind: 'admin', action: 'deleted', summary: 'Deleted screenshots', ref: 'admin:screenshots' })),
  R('POST', /^\/api\/security-test$/, () => ({ kind: 'security', action: 'ran', summary: 'Ran the security self-test', url: '/dashboard/security-test' })),
];

// ---------- writing ----------
export async function recordActivity(uid, entry) {
  if (!uid || !entry?.summary) return;
  const row = {
    kind: clip(entry.kind || 'other', 20),
    action: clip(entry.action || 'done', 20),
    summary: clip(entry.summary, 300),
    url: entry.url && /^\/[^/\\]/.test(entry.url) ? clip(entry.url, 500) : null,
    ref: entry.ref ? clip(`${entry.ref}:${entry.action || ''}`, 120) : null,
  };
  if (row.ref) {
    // Autosave and repeated edits: bump the last matching line instead of adding one.
    const res = await query(
      `UPDATE user_activity SET hits = hits + 1, summary = ?, url = COALESCE(?, url), updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND ref = ? AND source = 'live' AND updated_at >= NOW() - INTERVAL ${MERGE_WINDOW_MIN} MINUTE
        ORDER BY id DESC LIMIT 1`,
      [row.summary, row.url, uid, row.ref]
    );
    if (res.affectedRows) return;
  }
  await query('INSERT INTO user_activity (user_id, kind, action, summary, url, ref) VALUES (?, ?, ?, ?, ?, ?)', [
    uid, row.kind, row.action, row.summary, row.url, row.ref,
  ]);
}

async function sessionUserId(request) {
  const token = request.cookies?.get?.(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.sub ? Number(payload.sub) : null;
}

// Called by the route wrappers. Returns an `after(response)` callback, or
// null when this request isn't something worth recording.
export async function trackRequest(request, context) {
  try {
    const method = request?.method;
    if (!method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
    const path = new URL(request.url).pathname;
    const rule = RULES.find((r) => r.method === method && r.re.test(path));
    if (!rule) return null;
    const m = path.match(rule.re).map((p) => (p ? decodeURIComponent(p) : p));
    const bodyText = await request.clone().text().catch(() => '');
    let body = null;
    try {
      body = bodyText && bodyText.length < 200000 ? JSON.parse(bodyText) : null;
    } catch {}
    const uid = await sessionUserId(request);
    const c = { m, body, uid, params: context?.params, pre: null, res: null };
    if (rule.before && uid) c.pre = await rule.before(c).catch(() => null);

    return async (response) => {
      try {
        if (!response || response.status >= 400) return;
        if (path === '/api/auth/login' || path === '/api/auth/register') {
          const email = String(body?.email || '').trim().toLowerCase();
          c.uid = (await one('SELECT id FROM users WHERE email = ?', [email]))?.id || null;
        }
        if (!c.uid) return;
        if ((response.headers.get('content-type') || '').includes('application/json')) {
          c.res = await response.clone().json().catch(() => null);
        }
        await recordActivity(c.uid, rule.log(c));
      } catch (err) {
        console.error('Activity log failed:', err.message);
      }
    };
  } catch {
    return null;
  }
}

// ---------- reading ----------
// Everything a user did between two instants (ISO strings), newest first.
// Task-board actions come from task_activity; the rest from user_activity.
export async function listActivity(uid, { from, to, limit = 500 }) {
  await importHistory(uid);
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const rows = await query(
    `SELECT * FROM (
       SELECT CONCAT('a', id) AS id, kind, action, summary, url, hits, source, created_at, updated_at
         FROM user_activity WHERE user_id = ? AND kind <> 'system' AND updated_at >= ? AND created_at <= ?
       UNION ALL
       SELECT CONCAT('t', ta.id), 'task', ta.action, ta.summary, CONCAT('/dashboard/tasks/', b.uuid), 1, 'live', ta.created_at, ta.created_at
         FROM task_activity ta JOIN task_boards b ON b.id = ta.board_id
        WHERE ta.user_id = ? AND ta.created_at BETWEEN ? AND ?
     ) x ORDER BY created_at DESC, id DESC LIMIT ${lim}`,
    [uid, from, to, uid, from, to]
  );
  return rows.map((r) => ({
    ...r,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  }));
}

// ---------- one-time history import ----------
// Rebuilds what can be known about activity from before the log existed:
// tracks / notes / code / boards created, entries added per day, notes and
// entries last edited, leaves, logins, and accounts created. Runs once per
// user (a 'system' marker row records the cutoff), so nothing doubles up.
const imported = (globalThis.__myTrackHistoryImported ||= new Set());

export async function importHistory(uid) {
  if (imported.has(uid)) return;
  const marker = await one("SELECT created_at FROM user_activity WHERE user_id = ? AND kind = 'system' AND action = 'history'", [uid]);
  if (marker) {
    imported.add(uid);
    return;
  }
  // Only rows older than the first live-logged action, so live and rebuilt lines never overlap.
  const first = await one("SELECT MIN(created_at) AS t FROM user_activity WHERE user_id = ? AND source = 'live'", [uid]);
  const cutoff = first?.t || new Date();
  // Each source is optional (a table may not exist on an older database).
  const ins = (select, args) =>
    query(`INSERT IGNORE INTO user_activity (user_id, kind, action, summary, url, source, history_key, created_at, updated_at) ${select}`, args)
      .catch((err) => console.error('History import step skipped:', err.message));

  await ins(
    `SELECT user_id, 'track', 'created', CONCAT('Created track “', LEFT(name, 80), '”'), CONCAT('/dashboard/tracks/', uuid), 'history', CONCAT('track:', id), created_at, created_at
       FROM tracks WHERE user_id = ? AND created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT t.user_id, 'entry', 'created',
            CONCAT('Added ', COUNT(*), IF(COUNT(*) = 1, ' entry', ' entries'), ' to “', LEFT(t.name, 80), '”'),
            CONCAT('/dashboard/tracks/', t.uuid), 'history', CONCAT('entries:', t.id, ':', DATE(e.created_at)), MIN(e.created_at), MAX(e.created_at)
       FROM track_entries e JOIN tracks t ON t.id = e.track_id
      WHERE t.user_id = ? AND e.created_at < ?
      GROUP BY t.id, DATE(e.created_at)`, [uid, cutoff]);
  await ins(
    `SELECT t.user_id, 'entry', 'edited',
            CONCAT('Edited ', COUNT(*), IF(COUNT(*) = 1, ' entry', ' entries'), ' in “', LEFT(t.name, 80), '”'),
            CONCAT('/dashboard/tracks/', t.uuid), 'history', CONCAT('entries-edit:', t.id, ':', DATE(e.updated_at)), MIN(e.updated_at), MAX(e.updated_at)
       FROM track_entries e JOIN tracks t ON t.id = e.track_id
      WHERE t.user_id = ? AND e.updated_at < ? AND e.updated_at > e.created_at + INTERVAL 1 MINUTE
      GROUP BY t.id, DATE(e.updated_at)`, [uid, cutoff]);
  await ins(
    `SELECT user_id, 'note', 'created', CONCAT('Created note “', LEFT(title, 80), '”'), CONCAT('/dashboard/notes/', uuid), 'history', CONCAT('note:', id), created_at, created_at
       FROM notes WHERE user_id = ? AND created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT user_id, 'note', 'edited', CONCAT('Edited note “', LEFT(title, 80), '”'), CONCAT('/dashboard/notes/', uuid), 'history', CONCAT('note-edit:', id), updated_at, updated_at
       FROM notes WHERE user_id = ? AND updated_at < ? AND updated_at > created_at + INTERVAL 1 MINUTE`, [uid, cutoff]);
  await ins(
    `SELECT user_id, 'code', 'created', CONCAT('Created code file “', LEFT(name, 80), '”'), CONCAT('/dashboard/code/', uuid), 'history', CONCAT('code:', id), created_at, created_at
       FROM code_snippets WHERE user_id = ? AND created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT s.user_id, 'code', 'saved', CONCAT('Saved a version of “', LEFT(s.name, 80), '”'), CONCAT('/dashboard/code/', s.uuid), 'history', CONCAT('code-version:', v.id), v.created_at, v.created_at
       FROM code_versions v JOIN code_snippets s ON s.id = v.snippet_id WHERE s.user_id = ? AND v.created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT user_id, 'calendar', 'created', CONCAT('Marked ', leave_type, ' leave ', DATE_FORMAT(start_date, '%d %b'), IF(end_date > start_date, CONCAT(' → ', DATE_FORMAT(end_date, '%d %b')), '')),
            '/dashboard/calendar', 'history', CONCAT('leave:', id), created_at, created_at
       FROM calendar_leaves WHERE user_id = ? AND created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT user_id, 'account', 'signin', 'Signed in', NULL, 'history', CONCAT('login:', id), created_at, created_at
       FROM login_events WHERE user_id = ? AND created_at < ?`, [uid, cutoff]);
  await ins(
    `SELECT created_by, 'user', 'created', CONCAT('Created a user account for “', LEFT(name, 80), '”'), '/dashboard/users', 'history', CONCAT('user:', id), created_at, created_at
       FROM users WHERE created_by = ? AND created_at < ?`, [uid, cutoff]);
  await query("INSERT IGNORE INTO user_activity (user_id, kind, action, summary, source, history_key) VALUES (?, 'system', 'history', 'History imported', 'history', 'system:history')", [uid]);
  imported.add(uid);
}
