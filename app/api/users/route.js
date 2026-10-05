import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { permissionLabel } from '@/lib/taskConfig';
import { logActivity } from '@/lib/taskServer';
import { listUsersFor, myAdminBoards, EMAIL_RE } from '@/lib/usersServer';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [users, boards] = await Promise.all([listUsersFor(user), myAdminBoards(user)]);
  return NextResponse.json({ users, boards });
});

// Create an account on someone's behalf. Optionally add it straight to one of
// the task boards you administer.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name) return NextResponse.json({ error: 'Enter the person’s name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: 'The password must be at least 6 characters.' }, { status: 400 });

  let board = null;
  if (body.board_uuid) {
    board = (await query('SELECT * FROM task_boards WHERE uuid = ? AND owner_id = ?', [body.board_uuid, user.id]))[0];
    if (!board) return NextResponse.json({ error: 'You can only add people to boards you administer.' }, { status: 403 });
  }

  const existing = await query('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
  if (existing[0]) {
    return NextResponse.json(
      { error: 'An account with that email already exists. Add them to a board from the board’s Settings → Members.' },
      { status: 409 }
    );
  }

  let result;
  try {
    result = await query('INSERT INTO users (name, email, password, created_by) VALUES (?, ?, ?, ?)', [
      name,
      email,
      await hashPassword(password),
      user.id,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }
    throw err;
  }
  const newId = result.insertId;

  if (board) {
    const perms = { can_add: Boolean(body.can_add), can_edit: Boolean(body.can_edit), can_delete: Boolean(body.can_delete) };
    await query('INSERT INTO task_members (board_id, user_id, can_add, can_edit, can_delete) VALUES (?, ?, ?, ?, ?)', [
      board.id,
      newId,
      perms.can_add ? 1 : 0,
      perms.can_edit ? 1 : 0,
      perms.can_delete ? 1 : 0,
    ]);
    await logActivity(null, {
      boardId: board.id,
      user,
      action: 'member_add',
      summary: `Created an account for ${name} (${email}) and added them as a member (${permissionLabel(perms)})`,
    });
  }
  return NextResponse.json({ ok: true, id: newId });
});
