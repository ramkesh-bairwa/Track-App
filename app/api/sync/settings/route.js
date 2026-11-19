import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/syncAuth';
import { syncConnection, getState, setState } from '@/lib/sync';

const KEYS = ['remote_url', 'remote_key', 'last_run_at', 'last_result', 'last_error', 'pull_cursor'];

function publicState(s) {
  let result = null;
  try {
    result = s.last_result ? JSON.parse(s.last_result) : null;
  } catch {
    result = null;
  }
  return {
    remoteUrl: s.remote_url || '',
    keyHint: s.remote_key ? `…${s.remote_key.slice(-4)}` : '',
    lastRunAt: s.last_run_at || null,
    lastResult: result,
    lastError: s.last_error || '',
    everSynced: Boolean(s.pull_cursor),
  };
}

// Which install this one syncs with (the other side's address + key).
export const GET = withApiErrors(async () => {
  const { error } = await requireAdmin();
  if (error) return error;
  const conn = await syncConnection();
  try {
    return NextResponse.json(publicState(await getState(conn, KEYS)));
  } finally {
    await conn.end();
  }
});

export const PUT = withApiErrors(async (request) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const url = String(body.remoteUrl || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/[^\s/]+/i.test(url)) return NextResponse.json({ error: 'Enter the other app’s address, like http://localhost:3000' }, { status: 400 });
  const conn = await syncConnection();
  try {
    const before = await getState(conn, ['remote_url']);
    const values = { remote_url: url };
    if (typeof body.remoteKey === 'string' && body.remoteKey.trim()) values.remote_key = body.remoteKey.trim();
    // A different install starts from scratch (a full merge on first sync).
    if (before.remote_url !== url) Object.assign(values, { pull_cursor: null, push_cursor: null, last_result: null, last_error: null, last_run_at: null });
    await setState(conn, values);
    return NextResponse.json(publicState(await getState(conn, KEYS)));
  } finally {
    await conn.end();
  }
});
