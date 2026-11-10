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
