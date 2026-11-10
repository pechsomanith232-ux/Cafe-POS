import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  hasPermission,
  permissionLimit,
  requirePermission,
  type AppContext,
} from "@/lib/permissions";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

// A user who is a Manager at B1 and a Cashier at B2.
const ctx = {
  userId: "u1",
  userName: "Dara",
  orgId: "org",
  branchId: B1,
  branchIds: [B1, B2],
  access: new Map([
    [B1, { branchId: B1, roleId: "r-m", roleName: "Manager", permissions: new Map([["settings.manage", null], ["pos.sell", null]]) }],
    [B2, { branchId: B2, roleId: "r-c", roleName: "Cashier", permissions: new Map([["pos.sell", null], ["pos.discount.apply", "10.0000"]]) }],
  ]),
} as unknown as AppContext;

describe("hasPermission", () => {
  it("is true for a permission the user's role has at that branch", () => {
    expect(hasPermission(ctx, B1, "settings.manage")).toBe(true);
  });
  it("is false at a branch where the user's role lacks it", () => {
    expect(hasPermission(ctx, B2, "settings.manage")).toBe(false);
  });
  it("is false at a branch the user doesn't belong to", () => {
    expect(hasPermission(ctx, OTHER, "pos.sell")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("passes silently when allowed", () => {
    expect(() => requirePermission(ctx, B1, "settings.manage")).not.toThrow();
  });
  it("throws ForbiddenError naming the permission when not allowed", () => {
    expect(() => requirePermission(ctx, B2, "settings.manage")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, B2, "settings.manage")).toThrow(/settings\.manage/);
  });
  it("throws for a branch outside the user's branches", () => {
    expect(() => requirePermission(ctx, OTHER, "pos.sell")).toThrow(ForbiddenError);
  });
});

describe("permissionLimit", () => {
  it("returns the role's limit for that branch", () => {
    expect(permissionLimit(ctx, B2, "pos.discount.apply")).toBe("10.0000");
  });
  it("returns null for a permission held without a limit, undefined when not held", () => {
    expect(permissionLimit(ctx, B1, "pos.sell")).toBeNull();
    expect(permissionLimit(ctx, B1, "pos.discount.apply")).toBeUndefined();
  });
});
