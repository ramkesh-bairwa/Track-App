import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { hit, isLimited, retryAfter, reset } from '@/lib/rateLimit';

const MAX_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;

// Deletes Login history — always confirmed with the account's login password.
// {
//   password,
//   tab:   'mytrack' (your own logins) | 'system' (computer sign-ins; admins)
//   scope: 'photo' (keep the entry, remove its photo) | 'entry' | 'all'
//   uuid:  the entry, for photo / entry
// }
// Deletes travel to the other app on the next sync.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const tab = body.tab === 'system' ? 'system' : 'mytrack';
  const scope = ['photo', 'entry', 'all'].includes(body.scope) ? body.scope : null;
  if (!scope) return NextResponse.json({ error: 'Say what to delete.' }, { status: 400 });
  if (scope !== 'all' && typeof body.uuid !== 'string') return NextResponse.json({ error: 'Which entry?' }, { status: 400 });
  if (tab === 'system' && !user.is_admin) return NextResponse.json({ error: 'Only an admin can delete system logins.' }, { status: 403 });

  const key = `history-delete:${user.id}`;
  if (isLimited(key, MAX_TRIES)) {
    return NextResponse.json({ error: `Too many wrong passwords. Try again in ${Math.ceil(retryAfter(key) / 60)} min.` }, { status: 429 });
  }
  const [row] = await query('SELECT password FROM users WHERE id = ?', [user.id]);
  if (!row || typeof body.password !== 'string' || !(await verifyPassword(body.password, row.password))) {
    hit(key, { max: MAX_TRIES, windowMs: WINDOW_MS });
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401 });
  }
  reset(key);

  let result;
  if (tab === 'mytrack') {
    if (scope === 'photo') result = await query('UPDATE login_events SET photo = NULL WHERE uuid = ? AND user_id = ?', [body.uuid, user.id]);
    else if (scope === 'entry') result = await query('DELETE FROM login_events WHERE uuid = ? AND user_id = ?', [body.uuid, user.id]);
    else result = await query('DELETE FROM login_events WHERE user_id = ?', [user.id]);
  } else {
    if (scope === 'photo') result = await query('UPDATE system_events SET photo = NULL WHERE uuid = ?', [body.uuid]);
    else if (scope === 'entry') result = await query('DELETE FROM system_events WHERE uuid = ?', [body.uuid]);
    else result = await query('DELETE FROM system_events');
  }
  return NextResponse.json({ ok: true, changed: result.affectedRows || 0 });
});
