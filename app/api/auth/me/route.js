import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, hashPassword, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

const AVATAR_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,/;
const MAX_AVATAR_LENGTH = 2_000_000; // ~1.5MB decoded

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ user });
});

export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    fields.push('name = ?');
    values.push(body.name.trim().slice(0, 255));
  }

  if (typeof body.avatar === 'string') {
    const avatar = body.avatar.trim();
    if (avatar === '') {
      fields.push('avatar = ?');
      values.push(null);
    } else {
      if (!AVATAR_DATA_URL.test(avatar)) {
        return NextResponse.json({ error: 'Avatar must be an image.' }, { status: 400 });
      }
      if (avatar.length > MAX_AVATAR_LENGTH) {
        return NextResponse.json(
          { error: 'That image is too large. Please pick one under 1.5MB.' },
          { status: 400 }
        );
      }
      fields.push('avatar = ?');
      values.push(avatar);
    }
  }

  if (typeof body.newPassword === 'string' && body.newPassword) {
    if (body.newPassword.length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters.' },
        { status: 400 }
      );
    }
    const rows = await query('SELECT password FROM users WHERE id = ?', [user.id]);
    const valid = rows[0] && (await verifyPassword(body.currentPassword || '', rows[0].password));
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }
    fields.push('password = ?');
    values.push(await hashPassword(body.newPassword));
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  values.push(user.id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

  const rows = await query('SELECT id, name, email, avatar FROM users WHERE id = ?', [user.id]);
  return NextResponse.json({ user: rows[0] });
});
