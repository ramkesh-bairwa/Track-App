import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { clientIp, hit } from '@/lib/rateLimit';

const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;

export const POST = withApiErrors(async (request) => {
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email and password are required.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (name.length > 100 || email.length > 255 || password.length > 200) {
    return NextResponse.json({ error: 'Name, email or password is too long.' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  // Account-spam guard: 30 sign-ups per address per hour.
  const limit = hit(`register:ip:${clientIp(request)}`, { max: 30, windowMs: 60 * 60 * 1000 });
  if (limit.limited) {
    return NextResponse.json({ error: 'Too many sign-ups from here. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  }

  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const hashed = await hashPassword(password);
  const result = await query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [
    name,
    email,
    hashed,
  ]);

  const token = await createSessionToken({ sub: String(result.insertId), name, email });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // HTTPS-only in production; plain http://localhost keeps working in dev.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
});
