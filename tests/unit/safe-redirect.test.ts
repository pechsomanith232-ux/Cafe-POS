import { describe, expect, it } from "vitest";
import { safeRedirectPath, stripLocale } from "@/lib/safe-redirect";

const origin = "http://localhost:3000";

describe("safeRedirectPath (review #4: no open redirect after login)", () => {
  it("keeps paths inside the app", () => {
    expect(safeRedirectPath("/settings/users?tab=1", origin)).toBe("/settings/users?tab=1");
  });
  it.each([
    "//evil.com", "/\\evil.com", "/\tevil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "",
  ])("falls back to /dashboard for %j", (value) => {
    expect(safeRedirectPath(value, origin)).toBe("/dashboard");
  });
  it("falls back when missing", () => {
    expect(safeRedirectPath(null, origin)).toBe("/dashboard");
  });
});

describe("stripLocale (the next-intl router adds the locale back)", () => {
  it.each([
    ["/km/inventory/items?x=1", "/inventory/items?x=1"],
    ["/en/dashboard", "/dashboard"],
    ["/km", "/"],
    ["/km?x=1", "/?x=1"],
    ["/dashboard", "/dashboard"],
    ["/kmart/x", "/kmart/x"],
    ["/km//evil.com", "/evil.com"],
  ])("%j → %j", (input, out) => {
    expect(stripLocale(input)).toBe(out);
  });
});

describe("login redirect, composed (stripLocale(safeRedirectPath(next)))", () => {
  it.each([
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com/x", "/dashboard"],
    ["/km//evil.com", "/evil.com"],
    ["/kmx/a", "/kmx/a"],
    ["/km", "/"],
    ["/km/inventory/items?type=sale", "/inventory/items?type=sale"],
    ["/en/pos", "/pos"],
    [null, "/dashboard"],
  ])("%j gives %j, one leading slash, never //", (next, out) => {
    const result = stripLocale(safeRedirectPath(next, origin));
    expect(result).toBe(out);
    expect(result.startsWith("/") && !result.startsWith("//")).toBe(true);
  });
});
