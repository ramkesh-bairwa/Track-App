import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { query } from './db';
import { parseHiddenMenus } from './menuItems';
import { activeSelect } from './userStatus';

const COOKIE_NAME = 'mytrack_session';
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function createSessionToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;

// Cookie settings for a session token (same as at sign-in).
export function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

// While an admin uses "Open as this user", the person's passwords stay theirs.
export function impersonationBlock(user) {
  return user?.impersonator ? 'An admin using this account can’t change its passwords.' : null;
}

// Server Component / Route Handler helper: read the current user from the cookie
export async function getCurrentUser() {
  const store = cookies();
  // Web sends the session as an httpOnly cookie; the mobile app (and any API
  // client) sends it as `Authorization: Bearer <token>` instead.
  let token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    try {
      const auth = headers().get('authorization') || '';
      if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
    } catch {}
  }
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload?.sub) return null;
  const rows = await query(
    `SELECT id, name, email, avatar, require_password_delete, require_password_edit,
            sidebar_color, topbar_color, content_color, google_email, is_admin, hidden_menus,
            (action_password IS NOT NULL) AS has_action_password,
            (google_refresh_token IS NOT NULL) AS has_google_drive,
            ${await activeSelect('users')} AS is_active
     FROM users WHERE id = ?`,
    [payload.sub]
  );
  // A deactivated account is signed out everywhere.
  if (!rows[0] || !Number(rows[0].is_active)) return null;
  // "Open as this user" (app/api/admin/impersonate): the admin who opened
  // this session. Ends by itself if they stop being an admin.
  let impersonator = null;
  if (payload.imp) {
    const [admin] = await query('SELECT id, name, email, is_admin FROM users WHERE id = ?', [payload.imp]);
    if (!admin?.is_admin) return null;
    impersonator = { id: admin.id, name: admin.name, email: admin.email };
  }
  return {
    ...rows[0],
    require_password_delete: Boolean(rows[0].require_password_delete),
    require_password_edit: Boolean(rows[0].require_password_edit),
    has_action_password: Boolean(rows[0].has_action_password),
    has_google_drive: Boolean(rows[0].has_google_drive),
    is_admin: Boolean(rows[0].is_admin),
    hidden_menus: parseHiddenMenus(rows[0].hidden_menus),
    impersonator,
  };
}
