import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth wall — cookie-presence check.
 *
 * Phase 5.1: every route is private. This middleware runs on Edge, where
 * NextAuth's database-backed `auth()` can't reach Postgres. So we do the
 * cheap thing — does the session cookie exist? — and leave real session
 * validation (expired tokens, deleted rows) to the page-level `await auth()`
 * checks. Stale cookies briefly load the page and then redirect; that's the
 * standard NextAuth-with-database pattern.
 *
 * Public paths: /signin and /signin/*, /api/auth/*.
 * Static assets and Next internals are excluded via the matcher.
 */

const PUBLIC_PREFIXES = ['/signin', '/api/auth'];

const SESSION_COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
] as const;

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name));
  if (hasSessionCookie) return NextResponse.next();

  const url = new URL('/signin', req.url);
  if (pathname !== '/') url.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
