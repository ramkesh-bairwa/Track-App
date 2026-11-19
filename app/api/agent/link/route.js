import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { hit, clientIp } from '@/lib/rateLimit';
import { hashToken, newDeviceToken } from '@/lib/agent';

export const dynamic = 'force-dynamic';

// A desktop app links to this server: { email, password, deviceName, os,
// appVersion, deviceUuid? } → { token, device, user }. The token is shown
// once; only its hash is kept. Re-linking the same computer (same
// deviceUuid, same user) replaces its old token.
export const POST = withApiErrors(async (request) => {
  const limit = hit(`agent-link:${clientIp(request)}`, { max: 10, windowMs: 10 * 60 * 1000 });
  if (limit.limited) return NextResponse.json({ error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password for this server.' }, { status: 400 });
  const [user] = await query('SELECT id, name, email, password FROM users WHERE email = ?', [email]);
  if (!user || !(await verifyPassword(password, user.password))) {
    return NextResponse.json({ error: 'Wrong email or password for this server.' }, { status: 401 });
  }

  const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const token = newDeviceToken();
  const asked = /^[0-9a-f-]{36}$/i.test(String(body.deviceUuid || '')) ? String(body.deviceUuid).toLowerCase() : null;
  const [existing] = asked ? await query('SELECT id, user_id FROM desktop_devices WHERE uuid = ?', [asked]) : [];
  let id;
  if (existing && existing.user_id === user.id) {
    await query(
      'UPDATE desktop_devices SET token_hash = ?, name = ?, os = ?, app_version = ?, revoked_at = NULL, last_seen_at = NOW() WHERE id = ?',
      [hashToken(token), clip(body.deviceName, 255), clip(body.os, 50), clip(body.appVersion, 50), existing.id]
    );
    id = existing.id;
  } else {
    const uuid = existing ? crypto.randomUUID() : asked || crypto.randomUUID();
    const res = await query(
      'INSERT INTO desktop_devices (uuid, user_id, name, os, app_version, token_hash, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [uuid, user.id, clip(body.deviceName, 255), clip(body.os, 50), clip(body.appVersion, 50), hashToken(token)]
    );
    id = res.insertId;
  }
  const [device] = await query('SELECT uuid FROM desktop_devices WHERE id = ?', [id]);
  return NextResponse.json({ token, device: { uuid: device.uuid }, user: { name: user.name, email: user.email } });
});
