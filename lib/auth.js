import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { query } from './db';
import { parseHiddenMenus } from './menuItems';

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

// Server Component / Route Handler helper: read the current user from the cookie
export async function getCurrentUser() {
  const store = cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload?.sub) return null;
  const rows = await query(
    `SELECT id, name, email, avatar, require_password_delete, require_password_edit,
            sidebar_color, topbar_color, content_color, google_email, is_admin, hidden_menus,
            (action_password IS NOT NULL) AS has_action_password,
            (google_refresh_token IS NOT NULL) AS has_google_drive
     FROM users WHERE id = ?`,
    [payload.sub]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    require_password_delete: Boolean(rows[0].require_password_delete),
    require_password_edit: Boolean(rows[0].require_password_edit),
    has_action_password: Boolean(rows[0].has_action_password),
    has_google_drive: Boolean(rows[0].has_google_drive),
    is_admin: Boolean(rows[0].is_admin),
    hidden_menus: parseHiddenMenus(rows[0].hidden_menus),
  };
}
