import { NextResponse } from 'next/server';
import { query } from './db';
import { verifyPassword } from './auth';
import { hit, reset } from './rateLimit';

// Deleting a note or a task needs a password: the privacy password if one is
// set (Settings → Privacy), otherwise the account's login password.
// Returns an error response to send back, or null when the password is right.
// Wrong guesses are limited to 10 per 15 minutes per user, across both.
export async function checkDeletePassword(request, userId) {
  const limitKey = `delete-password:${userId}`;
  const limit = hit(limitKey, { max: 10, windowMs: 15 * 60 * 1000 });
  if (limit.limited) {
    return NextResponse.json(
      { error: 'Too many wrong passwords. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }
  const body = await request.json().catch(() => ({}));
  const [pw] = await query('SELECT password, action_password FROM users WHERE id = ?', [userId]);
  if (!pw || !(await verifyPassword(String(body.password || ''), pw.action_password || pw.password))) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 403 });
  }
  reset(limitKey);
  return null;
}
