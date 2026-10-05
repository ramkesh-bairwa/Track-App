import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'mytrack_session';
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');

async function isAuthenticated(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Tracker screenshots sit in public/ but are private: they're served only
  // through /api/calendar/screenshots, which checks the owner.
  if (pathname.startsWith('/system-tracker')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const authed = await isAuthenticated(request);

  if (pathname.startsWith('/dashboard') && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if ((pathname === '/login' || pathname === '/register') && authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/system-tracker/:path*', '/dashboard/:path*', '/login', '/register'],
};
