import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const protectedRoutes = ['/dashboard', '/chat', '/onboard', '/settings', '/admin'];

// Routes that should redirect to dashboard if authenticated
const authRoutes = ['/login', '/signup', '/forgot-password'];

// Cookie name for auth session marker
const AUTH_COOKIE = 'campfire-auth-session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for auth session marker cookie
  // Note: This is a simple marker set by client-side JS when authenticated
  // The actual token validation happens client-side
  const hasAuthCookie = request.cookies.has(AUTH_COOKIE);

  // Check if requesting a protected route
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // Check if requesting an auth route
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !hasAuthCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && hasAuthCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/chat/:path*',
    '/onboard/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/login',
    '/signup',
    '/forgot-password',
  ],
};
