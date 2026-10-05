import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getBoardAccess, loadBoardPayload, boardStatuses, logActivity, parseJson, boardColumns } from '@/lib/taskServer';
import { orderTaskColumns } from '@/lib/taskConfig';

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await loadBoardPayload(access, user));
});

const HEX = /^#[0-9a-fA-F]{6}$/;

// Admin only: name, description, visibility, the status list, column order
// and which columns the task listing shows.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can change board settings.' }, { status: 403 });

  const { board } = access;
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  const changes = [];

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 255);
    if (!name) return NextResponse.json({ error: 'The board needs a name.' }, { status: 400 });
    if (name !== board.name) {
      fields.push('name = ?');
      values.push(name);
      changes.push({ key: 'name', label: 'Name', oldText: board.name, newText: name });
    }
  }
  if (typeof body.description === 'string') {
    const description = body.description.trim().slice(0, 500);
    if (description !== (board.description || '')) {
      fields.push('description = ?');
      values.push(description || null);
      changes.push({ key: 'description', label: 'Description', oldText: board.description || '', newText: description });
    }
  }
  if (typeof body.show_serial === 'boolean') {
    const v = body.show_serial ? 1 : 0;
    if (v !== (board.show_serial ? 1 : 0)) {
      fields.push('show_serial = ?');
      values.push(v);
      changes.push({ key: 'show_serial', label: 'Sr. No. column', oldText: board.show_serial ? 'on' : 'off', newText: v ? 'on' : 'off' });
    }
  }
  if (Array.isArray(body.hidden_columns)) {
    // Title always shows, so every row stays identifiable.
    const hidden = [...new Set(body.hidden_columns.filter((k) => typeof k === 'string' && k.length <= 40 && k !== 'title'))].slice(0, 100);
    const before = parseJson(board.hidden_columns, []);
    if (JSON.stringify([...before].sort()) !== JSON.stringify([...hidden].sort())) {
      const cols = orderTaskColumns(parseJson(board.column_order, null), await boardColumns(board.id));
      const names = (keys) => cols.filter((c) => keys.includes(c.key)).map((c) => c.label).join(', ') || 'none';
      fields.push('hidden_columns = ?');
      values.push(JSON.stringify(hidden));
      changes.push({ key: 'hidden_columns', label: 'Hidden columns', oldText: names(before), newText: names(hidden) });
    }
  }
  if (body.visibility === 'public' || body.visibility === 'private') {
    if (body.visibility !== board.visibility) {
      fields.push('visibility = ?');
      values.push(body.visibility);
      changes.push({ key: 'visibility', label: 'Visibility', oldText: board.visibility, newText: body.visibility });
    }
  }
  if (Array.isArray(body.statuses)) {
    const seen = new Set();
    const statuses = [];
    for (const s of body.statuses) {
      const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 50) : '';
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      statuses.push({ name, color: HEX.test(s.color) ? s.color : '#8B93A5' });
    }
    if (statuses.length === 0) return NextResponse.json({ error: 'Keep at least one status.' }, { status: 400 });
    const before = boardStatuses(board);
    const inUse = await query(
      'SELECT DISTINCT status FROM tasks WHERE board_id = ? AND deleted_at IS NULL',
      [board.id]
    );
    const missing = inUse.map((r) => r.status).filter((st) => !statuses.some((s) => s.name === st));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Tasks still use ${missing.map((m) => `"${m}"`).join(', ')} — move them to another status first.` },
        { status: 400 }
      );
    }
    const oldText = before.map((s) => s.name).join(', ');
    const newText = statuses.map((s) => s.name).join(', ');
    if (JSON.stringify(before) !== JSON.stringify(statuses)) {
      fields.push('statuses = ?');
      values.push(JSON.stringify(statuses));
      changes.push({ key: 'statuses', label: 'Statuses', oldText, newText: oldText === newText ? `${newText} (colors changed)` : newText });
    }
  }

  // Column order is a display preference — saved, but not worth a log entry.
  if (Array.isArray(body.column_order)) {
    const order = [...new Set(body.column_order.filter((k) => typeof k === 'string' && k.length <= 40))].slice(0, 100);
    await query('UPDATE task_boards SET column_order = ? WHERE id = ?', [JSON.stringify(order), board.id]);
  }

  if (fields.length === 0) return NextResponse.json({ ok: true });
  values.push(board.id);
  await query(`UPDATE task_boards SET ${fields.join(', ')} WHERE id = ?`, values);
  await logActivity(null, {
    boardId: board.id,
    user,
    action: 'board_update',
    summary: `Updated board settings (${changes.map((c) => c.label.toLowerCase()).join(', ')})`,
    changes,
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can delete the board.' }, { status: 403 });
  await query('DELETE FROM task_boards WHERE id = ?', [access.board.id]);
  return NextResponse.json({ ok: true });
});
