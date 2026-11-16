import { routing } from "@/i18n/routing";

/**
 * Where to go after login. Only same-origin paths are allowed: anything that
 * resolves to another origin (//x, /\x, tabs, schemes) falls back to the
 * dashboard, so `/login?next=…` can't be used to send people to another site.
 */
export function safeRedirectPath(value: string | null | undefined, origin: string): string {
  const fallback = "/dashboard";
  if (!value || !value.startsWith("/") || /[\\\s\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=[/?#]|$)`);

/**
 * Drops a leading /{locale} from a safe path: the proxy puts the locale into
 * `next`, and the next-intl router adds it again. Always returns one leading "/".
 */
export function stripLocale(path: string): string {
  return "/" + path.replace(LOCALE_PREFIX, "").replace(/^\/+/, "");
}
