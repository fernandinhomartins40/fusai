import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

/**
 * Fast gate for protected areas: no session cookie -> sign-in page.
 * The real session and role checks happen in the server layouts (and in the API).
 */
export function middleware(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/entrar';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
