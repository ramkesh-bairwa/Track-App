import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { permissionLabel } from '@/lib/taskConfig';
import { getBoardAccess, logActivity } from '@/lib/taskServer';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin adds someone to the board, either:
//  - an existing account, by its exact email (there's no user directory to
//    browse, so nobody's account list is exposed), or
//  - `create: true` — a brand-new account the admin sets up with a name and
//    starting password (the person can change it later in their profile).
//    If that email is already registered, the existing account is added
//    instead and its password is left untouched.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can add members.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });

  let member = (await query('SELECT id, name FROM users WHERE LOWER(email) = ?', [email]))[0];
  let created = false;

  if (!member) {
    if (!body.create) {
      return NextResponse.json(
        { error: 'No MyTrack account uses that email. Use “Create new user” to make one.' },
        { status: 404 }
      );
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) return NextResponse.json({ error: 'Enter the person’s name.' }, { status: 400 });
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'That email address doesn’t look right.' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'The password must be at least 6 characters.' }, { status: 400 });

    try {
      const result = await query('INSERT INTO users (name, email, password, created_by) VALUES (?, ?, ?, ?)', [
        name,
        email,
        await hashPassword(password),
        user.id,
      ]);
      member = { id: result.insertId, name };
      created = true;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      // Registered by someone else a moment ago — fall back to adding them.
      member = (await query('SELECT id, name FROM users WHERE LOWER(email) = ?', [email]))[0];
    }
  }

  if (member.id === access.board.owner_id) {
    return NextResponse.json({ error: "That's you — the admin already has full access." }, { status: 400 });
  }
  const existing = await query('SELECT id FROM task_members WHERE board_id = ? AND user_id = ?', [access.board.id, member.id]);
  if (existing[0]) {
    return NextResponse.json({ ok: true, userId: member.id, alreadyMember: true, name: member.name });
  }

  const perms = {
    can_add: Boolean(body.can_add),
    can_edit: Boolean(body.can_edit),
    can_delete: Boolean(body.can_delete),
  };
  await query(
    'INSERT INTO task_members (board_id, user_id, can_add, can_edit, can_delete) VALUES (?, ?, ?, ?, ?)',
    [access.board.id, member.id, perms.can_add ? 1 : 0, perms.can_edit ? 1 : 0, perms.can_delete ? 1 : 0]
  );
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'member_add',
    summary: created
      ? `Created an account for ${member.name} (${email}) and added them as a member (${permissionLabel(perms)})`
      : `Added ${member.name} as a member (${permissionLabel(perms)})`,
  });
  return NextResponse.json({
    ok: true,
    userId: member.id,
    name: member.name,
    created,
    existingAccount: Boolean(body.create) && !created,
  });
});
