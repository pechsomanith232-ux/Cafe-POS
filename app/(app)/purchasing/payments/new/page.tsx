import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import { listPaymentMethods, listSupplierOptions } from "@/lib/queries/purchasing";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Record supplier payment · Café POS" };

export default async function NewPaymentPage({ searchParams }: PageProps<"/purchasing/payments/new">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "purchasing.pay")) {
    return <AccessDenied permission="purchasing.pay" />;
  }
  const sp = await searchParams;
  const [suppliers, methods] = await Promise.all([listSupplierOptions(ctx), listPaymentMethods(ctx)]);
  const preset = typeof sp.supplier === "string" && suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : "";
  return (
    <>
      <PageHeader title="Record supplier payment" description="Allocated to open invoices oldest first — change the amounts if needed. Anything left over becomes supplier credit." />
      <PaymentForm branchId={ctx.branchId} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, owed: s.owed ?? "0" }))} methods={methods.map((m) => ({ id: m.id, name: m.name }))} today={todayLocal()} presetSupplierId={preset} />
    </>
  );
}
