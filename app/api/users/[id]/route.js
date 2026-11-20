import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { EMAIL_RE } from '@/lib/usersServer';
import { checkDeletePassword } from '@/lib/deletePassword';
import { setUserActive } from '@/lib/userStatus';

// Edit an account you created — or, as an admin, any account that isn't
// another admin's: name, email, (optionally) reset its password, or
// { active: true|false } to turn it back on / deactivate it.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.impersonator) return NextResponse.json({ error: 'Go back to your own account to edit users.' }, { status: 403 });
  const target = (await query('SELECT id, name, email, created_by, is_admin FROM users WHERE id = ?', [params.id]))[0];
  const adminMayEdit = user.is_admin && target && (!target.is_admin || target.id === user.id);
  if (!target || (target.created_by !== user.id && !adminMayEdit)) {
    return NextResponse.json({ error: 'You can only edit accounts you created.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  if (typeof body.active === 'boolean') {
    if (target.id === user.id) return NextResponse.json({ error: 'You can’t deactivate your own account.' }, { status: 400 });
    await setUserActive(target.id, body.active);
    return NextResponse.json({ ok: true, active: body.active });
  }

  const fields = [];
  const values = [];

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 255);
    if (!name) return NextResponse.json({ error: 'The name can’t be empty.' }, { status: 400 });
    fields.push('name = ?');
    values.push(name);
  }
  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    if (email !== target.email.toLowerCase()) {
      const taken = await query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?', [email, target.id]);
      if (taken[0]) return NextResponse.json({ error: 'Another account already uses that email.' }, { status: 409 });
    }
    fields.push('email = ?');
    values.push(email);
  }
  if (typeof body.password === 'string' && body.password !== '') {
    if (body.password.length < 6) return NextResponse.json({ error: 'The new password must be at least 6 characters.' }, { status: 400 });
    fields.push('password = ?');
    values.push(await hashPassword(body.password));
  }

  if (fields.length === 0) return NextResponse.json({ ok: true });
  values.push(target.id);
  try {
    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Another account already uses that email.' }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ ok: true });
});

// Permanently delete an account you created — or, as an admin, any account
// that isn't another admin's — with everything it owns (tracks, notes, its
// task boards, history…). Needs your password. Never your own account.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.impersonator) return NextResponse.json({ error: 'Go back to your own account to delete users.' }, { status: 403 });
  const target = (await query('SELECT id, created_by, is_admin FROM users WHERE id = ?', [params.id]))[0];
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.id === user.id) return NextResponse.json({ error: 'You can’t delete your own account here.' }, { status: 400 });
  if (target.created_by !== user.id && !(user.is_admin && !target.is_admin)) {
    return NextResponse.json({ error: 'You can only delete accounts you created.' }, { status: 403 });
  }
  const wrong = await checkDeletePassword(request, user.id);
  if (wrong) return wrong;
  await query('DELETE FROM users WHERE id = ?', [target.id]);
  return NextResponse.json({ ok: true });
});
