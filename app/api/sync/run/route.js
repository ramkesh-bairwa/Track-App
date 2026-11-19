import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin, instanceId } from '@/lib/syncAuth';
import { syncConnection, getState, setState, exportChanges, applyChanges } from '@/lib/sync';

const g = globalThis;

async function remote(url, key, path, init = {}) {
  let res;
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(`Couldn’t reach ${url} — is the other MyTrack running? (${err.cause?.code || err.message})`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `The other app answered ${res.status}.`);
  return json;
}

// Sync now: pull the other install's changes and merge them here, then push
// this install's changes there. Newer change wins on both sides.
export const POST = withApiErrors(async (request) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const testOnly = new URL(request.url).searchParams.get('test') === '1';
  if (g.__myTrackSyncRunning && !testOnly) return NextResponse.json({ error: 'A sync is already running.' }, { status: 409 });

  const conn = await syncConnection();
  const started = Date.now();
  try {
    const s = await getState(conn, ['remote_url', 'remote_key', 'pull_cursor', 'push_cursor']);
    if (!s.remote_url || !s.remote_key) return NextResponse.json({ error: 'Enter the other app’s address and sync key first.' }, { status: 400 });

    // First: is that address this same app? (Checked before the key, so the
    // message points at the real mistake.)
    const me = await instanceId();
    const who = await remote(s.remote_url, '', '/api/sync/whoami').catch((err) => {
      if (/reach/.test(err.message)) throw err;
      return null; // an older install without /whoami — fall through to ping
    });
    const sameApp = () =>
      NextResponse.json(
        {
          error: `${s.remote_url} is this same app. Enter the OTHER app’s address — ${
            process.env.MYTRACK_DESKTOP === '1' ? 'the website’s address' : 'the desktop app’s address (Help → About MyTrack in the desktop app)'
          }.`,
        },
        { status: 400 }
      );
    if (who?.instance === me) return sameApp();
    const ping = await remote(s.remote_url, s.remote_key, '/api/sync/ping');
    if (ping.instance === me) return sameApp();
    if (testOnly) return NextResponse.json({ ok: true, kind: ping.kind, keyOwner: ping.keyOwner });

    g.__myTrackSyncRunning = true;
    try {
      // 1. Pull
      const theirs = await remote(s.remote_url, s.remote_key, `/api/sync/changes?since=${encodeURIComponent(s.pull_cursor || '')}`);
      const pulled = await applyChanges(theirs);
      // 2. Push (minus what just came from there)
      const ours = await exportChanges(s.push_cursor || null, { skip: pulled.applied });
      const pushed = await remote(s.remote_url, s.remote_key, '/api/sync/apply', { method: 'POST', body: JSON.stringify(ours) });

      const count = (p) => Object.values(p.tables || {}).reduce((n, rows) => n + rows.length, 0) + (p.tombstones?.length || 0);
      const result = {
        other: ping.kind,
        pulled: { received: count(theirs), ...pulled.stats },
        pushed: { sent: count(ours), ...pushed.stats },
        seconds: Math.round((Date.now() - started) / 100) / 10,
      };
      await setState(conn, {
        pull_cursor: theirs.now,
        push_cursor: ours.now,
        last_run_at: new Date().toISOString(),
        last_result: JSON.stringify(result),
        last_error: null,
      });
      return NextResponse.json({ ok: true, ...result });
    } finally {
      g.__myTrackSyncRunning = false;
    }
  } catch (err) {
    await setState(conn, { last_error: err.message, last_run_at: new Date().toISOString() }).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 502 });
  } finally {
    await conn.end();
  }
});
