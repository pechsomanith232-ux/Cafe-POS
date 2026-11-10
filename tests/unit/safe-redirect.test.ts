import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

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
