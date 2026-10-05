import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, hashPassword, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    hasActionPassword: user.has_action_password,
    requireDelete: user.require_password_delete,
    requireEdit: user.require_password_edit,
  });
});

export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rows = await query('SELECT action_password FROM users WHERE id = ?', [user.id]);
  const existingHash = rows[0]?.action_password || null;

  const fields = [];
  const values = [];
  let willHavePassword = Boolean(existingHash);

  if (typeof body.newPassword === 'string' && body.newPassword) {
    if (body.newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Privacy password must be at least 6 characters.' },
        { status: 400 }
      );
    }
    if (existingHash) {
      const valid = await verifyPassword(body.oldPassword || '', existingHash);
      if (!valid) {
        return NextResponse.json({ error: 'Current privacy password is incorrect.' }, { status: 400 });
      }
    }
    fields.push('action_password = ?');
    values.push(await hashPassword(body.newPassword));
    willHavePassword = true;
  }

  if (typeof body.requireDelete === 'boolean') {
    if (body.requireDelete && !willHavePassword) {
      return NextResponse.json(
        { error: 'Set a privacy password before requiring it for deletes.' },
        { status: 400 }
      );
    }
    fields.push('require_password_delete = ?');
    values.push(body.requireDelete ? 1 : 0);
  }

  if (typeof body.requireEdit === 'boolean') {
    if (body.requireEdit && !willHavePassword) {
      return NextResponse.json(
        { error: 'Set a privacy password before requiring it for edits.' },
        { status: 400 }
      );
    }
    fields.push('require_password_edit = ?');
    values.push(body.requireEdit ? 1 : 0);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  values.push(user.id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

  const updated = await query(
    `SELECT require_password_delete, require_password_edit,
            (action_password IS NOT NULL) AS has_action_password
     FROM users WHERE id = ?`,
    [user.id]
  );
  const row = updated[0];
  return NextResponse.json({
    hasActionPassword: Boolean(row.has_action_password),
    requireDelete: Boolean(row.require_password_delete),
    requireEdit: Boolean(row.require_password_edit),
  });
});
