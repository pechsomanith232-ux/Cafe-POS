import { describe, expect, it } from "vitest";
import { visibleNav } from "@/lib/nav";
import type { AppContext } from "@/lib/permissions";

function ctxWith(perms: string[]): AppContext {
  return {
    branchId: "b1",
    branchIds: ["b1"],
    access: new Map([["b1", { permissions: new Map(perms.map((p) => [p, null])) }]]),
  } as unknown as AppContext;
}

const hrefs = (ctx: AppContext) => visibleNav(ctx).flatMap((g) => g.items.map((i) => i.href));

describe("visibleNav", () => {
  it("hides settings and audit from a cashier", () => {
    const links = hrefs(ctxWith(["pos.sell", "pos.hold", "shift.open"]));
    expect(links).toContain("/dashboard");
    expect(links).toContain("/account");
    expect(links.some((h) => h.startsWith("/settings"))).toBe(false);
    expect(links).not.toContain("/audit");
  });

  it("shows each settings page only with its permission", () => {
    const links = hrefs(ctxWith(["users.manage"]));
    expect(links).toContain("/settings/users");
    expect(links).not.toContain("/settings/roles");
    expect(links).not.toContain("/settings/branches");
  });

  it("hides the kitchen screen when the branch turned the kitchen off", () => {
    const ctx = ctxWith(["pos.sell"]);
    expect(hrefs(ctx)).toContain("/kitchen");
    expect(visibleNav(ctx, { kitchenEnabled: false }).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/kitchen");
  });

  it("drops groups that end up empty", () => {
    const groups = visibleNav(ctxWith([]));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("shows Inventory pages by permission: view → items + movements; adjust/count separately", () => {
    const viewer = hrefs(ctxWith(["inventory.view"]));
    expect(viewer).toEqual(expect.arrayContaining(["/inventory/items", "/inventory/movements"]));
    expect(viewer).not.toContain("/inventory/adjustments");
    expect(viewer).not.toContain("/inventory/counts");
    const keeper = hrefs(ctxWith(["inventory.view", "inventory.adjust", "inventory.count"]));
    expect(keeper).toEqual(expect.arrayContaining(["/inventory/adjustments", "/inventory/counts"]));
  });

  it("shows Purchasing pages by permission", () => {
    const keeper = hrefs(ctxWith(["purchasing.view", "purchasing.receive", "purchasing.direct"]));
    expect(keeper).toEqual(expect.arrayContaining(["/purchasing/suppliers", "/purchasing/receipts", "/purchasing/receipts/new?type=direct"]));
    expect(keeper).not.toContain("/purchasing/payments");
    expect(keeper).not.toContain("/purchasing/aging");
    const cashierWithDirect = hrefs(ctxWith(["purchasing.direct"]));
    expect(cashierWithDirect).toContain("/purchasing/receipts/new?type=direct");
    expect(cashierWithDirect).not.toContain("/purchasing/suppliers");
    const accountant = hrefs(ctxWith(["purchasing.view", "purchasing.pay", "reports.ap"]));
    expect(accountant).toEqual(expect.arrayContaining(["/purchasing/payments", "/purchasing/aging"]));
  });
  it("shows Menu pages to anyone with menu.view or menu.manage", () => {
    for (const perm of ["menu.view", "menu.manage"]) {
      expect(hrefs(ctxWith([perm]))).toEqual(expect.arrayContaining(["/menu/products", "/menu/modifiers", "/menu/categories"]));
    }
    expect(hrefs(ctxWith(["inventory.view"])).some((h) => h.startsWith("/menu"))).toBe(false);
  });
  it("shows POS and Kitchen with pos.sell, POS settings with settings.manage", () => {
    expect(hrefs(ctxWith(["pos.sell"]))).toEqual(expect.arrayContaining(["/pos", "/kitchen"]));
    expect(hrefs(ctxWith(["menu.view"]))).not.toContain("/pos");
    expect(hrefs(ctxWith(["settings.manage"]))).toContain("/settings/pos");
  });
  it("shows Customers with customers.manage or ar.receive_payment", () => {
    expect(hrefs(ctxWith(["customers.manage"]))).toContain("/customers");
    expect(hrefs(ctxWith(["ar.receive_payment"]))).toContain("/customers");
    expect(hrefs(ctxWith(["pos.sell"]))).not.toContain("/customers");
  });
});
