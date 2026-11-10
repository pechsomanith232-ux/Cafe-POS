import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ReceiptEditor } from "@/components/purchasing/receipt-editor";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { currentRate, getOpenShift, listRegisters } from "@/lib/queries/pos";
import { hasPermission } from "@/lib/permissions";
import { listPaymentMethods, listPurchasableItems, listSupplierOptions } from "@/lib/queries/purchasing";

export const metadata = { title: "New goods receipt · Café POS" };

export default async function NewReceiptPage({ searchParams }: PageProps<"/purchasing/receipts/new">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const type = sp.type === "direct" ? "direct" : "credit";
  const perm = type === "direct" ? "purchasing.direct" : "purchasing.receive";
  if (!hasPermission(ctx, ctx.branchId, perm)) return <AccessDenied permission={perm} />;
  const [items, suppliers, methods, registers, rate] = await Promise.all([
    listPurchasableItems(ctx), listSupplierOptions(ctx), listPaymentMethods(ctx), listRegisters(ctx, ctx.branchId), currentRate(ctx, ctx.branchId, "KHR"),
  ]);
  const drawers = (await Promise.all(registers.map(async (r) => ((await getOpenShift(ctx, ctx.branchId, r.id)) ? { registerId: r.id, name: r.name } : null)))).filter((d) => d !== null);
  const branch = ctx.access.get(ctx.branchId)!;
  const preset = typeof sp.supplier === "string" && suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : undefined;
  return (
    <>
      <PageHeader
        title={type === "direct" ? "Quick purchase (pay now)" : "New goods receipt"}
        description={type === "direct" ? `Bought and paid on the spot — e.g. a market run. ${branch.branchCode} · ${branch.branchName}` : `Supplier invoice on credit. ${branch.branchCode} · ${branch.branchName}`}
      />
      <ReceiptEditor
        type={type}
        branchId={ctx.branchId}
        items={items}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, paymentTermsDays: s.paymentTermsDays }))}
        methods={methods.filter((m) => m.type !== "account").map((m) => ({ id: m.id, name: m.name, type: m.type }))}
        drawers={drawers}
        presetRegisterId={typeof sp.register === "string" ? sp.register : undefined}
        branchRate={rate}
        today={todayLocal()}
        presetSupplierId={preset}
      />
    </>
  );
}
