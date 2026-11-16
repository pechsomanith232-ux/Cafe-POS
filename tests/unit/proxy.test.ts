import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";

const SESSION = "better-auth.session_token=abc";

function req(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy", () => {
  it("/ redirects to /en", async () => {
    const res = await proxy(req("/"));
    expect([307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/en$/);
  });

  it("keeps the locale cookie for unprefixed paths", async () => {
    const res = await proxy(req("/receipt/abc?print=1", `NEXT_LOCALE=km; ${SESSION}`));
    expect(res.headers.get("location")).toMatch(/\/km\/receipt\/abc\?print=1$/);
  });

  it("signed-out deep link goes to localized login with next", async () => {
    const res = await proxy(req("/km/pos"));
    expect(res.headers.get("location")).toMatch(/\/km\/login\?next=%2Fkm%2Fpos$/);
  });

  it("login page is reachable signed out", async () => {
    const res = await proxy(req("/km/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("signed-in page passes", async () => {
    const res = await proxy(req("/en/pos", SESSION));
    expect(res.headers.get("location")).toBeNull();
  });

  it("matcher skips api and files", () => {
    const re = new RegExp("^" + config.matcher[0] + "$");
    for (const p of ["/api/health", "/manifest.webmanifest", "/icons/icon-192.png", "/_next/static/x.js"])
      expect(re.test(p)).toBe(false);
    expect(re.test("/en/pos")).toBe(true);
  });
});
