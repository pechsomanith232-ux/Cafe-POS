import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const intl = createMiddleware(routing);

// Locale routing first (redirects unprefixed paths), then an optimistic auth
// check only: no session cookie → /{locale}/login. Every page and action still
// verifies the session and permissions on the server (plan §5.9).
export function proxy(request: NextRequest) {
  const response = intl(request);
  if (response.headers.get("location")) return response;

  const { pathname, search } = request.nextUrl;
  const [, locale, ...rest] = pathname.split("/");
  if (!getSessionCookie(request) && rest.join("/") !== "login") {
    const url = new URL(`/${locale}/login`, request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension (manifest, icons, favicon).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
