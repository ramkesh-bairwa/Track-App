import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request) {
  const url = new URL(request.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', url));

  function done(status) {
    const res = NextResponse.redirect(new URL(`/dashboard?google=${status}`, url));
    res.cookies.delete('google_oauth_state');
    return res;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = request.cookies.get('google_oauth_state')?.value;

  if (error) return done('denied');
  if (!code || !state || !cookieState || state !== cookieState) return done('error');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenJson.error_description || 'Token exchange failed.');
    if (!tokenJson.refresh_token) throw new Error('Google did not return a refresh token.');

    let googleEmail = null;
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (infoRes.ok) googleEmail = (await infoRes.json()).email || null;

    await query('UPDATE users SET google_refresh_token = ?, google_email = ? WHERE id = ?', [
      tokenJson.refresh_token,
      googleEmail,
      user.id,
    ]);

    return done('connected');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return done('error');
  }
}
