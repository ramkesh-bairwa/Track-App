import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { permissionLabel } from '@/lib/taskConfig';
import { getBoardAccess, logActivity } from '@/lib/taskServer';

async function loadMember(access, userId) {
  const rows = await query(
    `SELECT m.*, u.name FROM task_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND m.user_id = ?`,
    [access.board.id, userId]
  );
  return rows[0] || null;
}

// Admin changes a member's permissions.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can change permissions.' }, { status: 403 });
  const member = await loadMember(access, Number(params.userId));
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const next = {
    can_add: body.can_add !== undefined ? Boolean(body.can_add) : Boolean(member.can_add),
    can_edit: body.can_edit !== undefined ? Boolean(body.can_edit) : Boolean(member.can_edit),
    can_delete: body.can_delete !== undefined ? Boolean(body.can_delete) : Boolean(member.can_delete),
  };
  const before = { can_add: Boolean(member.can_add), can_edit: Boolean(member.can_edit), can_delete: Boolean(member.can_delete) };
  if (JSON.stringify(before) === JSON.stringify(next)) return NextResponse.json({ ok: true });

  await query('UPDATE task_members SET can_add = ?, can_edit = ?, can_delete = ? WHERE id = ?', [
    next.can_add ? 1 : 0,
    next.can_edit ? 1 : 0,
    next.can_delete ? 1 : 0,
    member.id,
  ]);
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'member_update',
    summary: `Changed ${member.name}'s permissions`,
    changes: [{ key: 'permissions', label: 'Permissions', oldText: permissionLabel(before), newText: permissionLabel(next) }],
  });
  return NextResponse.json({ ok: true });
});

// Admin removes a member, or a member leaves the board themselves.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const targetId = Number(params.userId);
  const leaving = targetId === user.id;
  if (!access.isAdmin && !leaving) {
    return NextResponse.json({ error: 'Only the board admin can remove members.' }, { status: 403 });
  }
  const member = await loadMember(access, targetId);
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  await query('DELETE FROM task_members WHERE id = ?', [member.id]);
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'member_remove',
    summary: leaving ? `${member.name} left the board` : `Removed ${member.name} from the board`,
  });
  return NextResponse.json({ ok: true });
});
