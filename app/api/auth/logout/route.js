import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

export const POST = withApiErrors(async () => {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
});
