import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword, createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { clientIp, hit, isLimited, reset, retryAfter } from '@/lib/rateLimit';
import { recordLogin, checkLoginPhoto } from '@/lib/loginHistory';

// Password guessing: 10 wrong passwords per email, or 100 failed logins per
// address, within 15 minutes → 429 until the window passes.
const WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL = 10;
const PER_IP = 100;

function tooMany(key) {
  const seconds = retryAfter(key);
  return NextResponse.json(
    { error: `Too many failed logins. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}.` },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  );
}

export const POST = withApiErrors(async (request) => {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const ipKey = `login:ip:${clientIp(request)}`;
  const emailKey = `login:email:${email}`;
  if (isLimited(emailKey, PER_EMAIL)) return tooMany(emailKey);
  if (isLimited(ipKey, PER_IP)) return tooMany(ipKey);
  const failed = () => {
    hit(emailKey, { max: PER_EMAIL, windowMs: WINDOW_MS });
    hit(ipKey, { max: PER_IP, windowMs: WINDOW_MS });
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  };

  const rows = await query('SELECT id, name, email, password FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user) return failed();

  const valid = await verifyPassword(password, user.password);
  if (!valid) return failed();
  reset(emailKey);

  // Audit the login. The webcam photo is best-effort: a blocked or missing
  // camera must never stop the account owner from signing in, so an invalid
  // photo is stored as null rather than rejecting the login.
  const photo = checkLoginPhoto(body.photo) ? null : body.photo;
  const eventId = await recordLogin(user.id, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') || '',
    photo,
  });

  const token = await createSessionToken({ sub: String(user.id), name: user.name, email: user.email });
  const response = NextResponse.json({ ok: true, eventId });
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
