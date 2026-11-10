import { eq } from "drizzle-orm";
import Link from "next/link";
import { branches } from "@/db/schema";
import { OpenShiftScreen } from "@/components/pos/shift-screens";
import { PosScreen } from "@/components/pos/pos-screen";
import { readBranchSettings } from "@/lib/branch-settings";
import { AccessDenied } from "@/components/shared/access-denied";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { hasPermission, permissionLimit } from "@/lib/permissions";
import { currentRate, getOpenShift, getPosMenu, listCurrencies, listDiningTables, listDiscountReasons, listOpenOrders, listRegisters } from "@/lib/queries/pos";
import { listPaymentMethods } from "@/lib/queries/purchasing";
import { getStorage } from "@/lib/storage";

const METHOD_ORDER = ["cash", "khqr", "card", "bank_transfer", "other", "account"];

export default async function PosPage({ searchParams }: PageProps<"/pos">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "pos.sell")) return <div className="p-8"><AccessDenied permission="pos.sell" /></div>;
  const registers = await listRegisters(ctx, ctx.branchId);
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, ctx.branchId));
  if (!registers.length) {
    return <div className="p-8 text-sm">This branch has no register. <Button asChild variant="link"><Link href="/dashboard">Back</Link></Button></div>;
  }
  const wanted = (await searchParams).register;
  const register = registers.find((r) => r.id === wanted) ?? registers[0];
  const [shift, currencies] = await Promise.all([getOpenShift(ctx, ctx.branchId, register.id), listCurrencies(ctx)]);
  const header = { branchName: branch.name, registerName: register.name, userName: ctx.userName, registers: registers.map((r) => ({ id: r.id, name: r.name })), registerId: register.id };
  if (!shift) {
    return <OpenShiftScreen {...header} branchId={ctx.branchId} currencies={currencies.map((c) => ({ code: c.code, symbol: c.symbol }))} canOpen={hasPermission(ctx, ctx.branchId, "shift.open")} />;
  }
  const canHold = hasPermission(ctx, ctx.branchId, "pos.hold");
  const [menu, tables, rate, reasons, held, methods] = await Promise.all([
    getPosMenu(ctx), listDiningTables(ctx, ctx.branchId), currentRate(ctx, ctx.branchId, "KHR"), listDiscountReasons(ctx),
    listOpenOrders(ctx, ctx.branchId),
    listPaymentMethods(ctx),
  ]);
  const storage = getStorage();
  const images = Object.fromEntries(await Promise.all(menu.products.filter((p) => p.imageKey).map(async (p) => [p.id, await storage.url(p.imageKey!)] as const)));
  const khr = currencies.find((c) => c.code === "KHR");
  const limit = permissionLimit(ctx, ctx.branchId, "pos.discount.apply");
  return (
    <PosScreen
      {...header}
      branchId={ctx.branchId}
      shift={{ id: shift.id, openedAt: shift.openedAt.toISOString(), openedByName: shift.openedByName, cash: shift.cash.map((c) => ({ currencyCode: c.currencyCode, openingFloat: c.openingFloat })) }}
      menu={menu}
      images={images}
      tables={tables.map((t) => ({ id: t.id, name: t.name, area: t.area }))}
      khr={rate && khr ? { rate, rounding: khr.cashRounding } : null}
      tax={{ rate: branch.taxRate, inclusive: branch.taxInclusive }}
      discountLimit={limit === undefined ? -1 : limit === null ? null : Number(limit)}
      reasons={reasons.map((r) => r.name)}
      heldCount={held.length}
      userId={ctx.userId}
      methods={methods.map((m) => ({ id: m.id, name: m.name, type: m.type })).sort((a, b) => METHOD_ORDER.indexOf(a.type) - METHOD_ORDER.indexOf(b.type))}
      currencies={currencies.filter((c) => c.code === "USD" || (c.code === "KHR" && rate)).map((c) => ({ code: c.code, decimals: c.decimals, cashRounding: c.cashRounding, rate: c.code === "USD" ? "1" : rate! }))}
      canChargeAccount={hasPermission(ctx, ctx.branchId, "pos.charge_account")}
      canCashMovement={hasPermission(ctx, ctx.branchId, "shift.cash_movement")}
      canQuickPurchase={hasPermission(ctx, ctx.branchId, "purchasing.direct")}
      canHold={canHold}
      kitchenEnabled={readBranchSettings(branch.settings).kitchenEnabled}
      canCloseShift={hasPermission(ctx, ctx.branchId, "shift.close")}
    />
  );
}
