import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no session cookie → /login. Every page and action
// still verifies the session and permissions on the server (plan §5.9).
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the login page, auth/health APIs, the PWA manifest + icons and Next internals.
  matcher: ["/((?!login|api/auth|api/health|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
