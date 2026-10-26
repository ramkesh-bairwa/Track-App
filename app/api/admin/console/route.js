import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';
import { listActions, runAction, ACTIONS } from '@/lib/serverConsole';

// Admin-only. The browser sends { action: '<id>' }; the id must be one of the
// fixed keys in lib/serverConsole.js — never a command. See that file's note.

export const GET = withApiErrors(async () => {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ actions: listActions() });
});

export const POST = withApiErrors(async (request) => {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = typeof body.action === 'string' ? body.action : '';
  // Only `ls` uses an argument; cap its length so it can't be abused.
  const arg = typeof body.arg === 'string' ? body.arg.slice(0, 300) : '';
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, id)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const started = Date.now();
  const result = await runAction(id, arg);
  const ms = Date.now() - started;

  // eslint-disable-next-line no-console
  console.log(`[server-console] ${user.email} ran "${id}" (${result.ok ? 'ok' : 'fail'}, ${ms}ms)`);

  return NextResponse.json({
    ok: result.ok,
    output: result.output,
    filename: result.filename || null,
    download: Boolean(ACTIONS[id].download),
    ms,
  });
});
