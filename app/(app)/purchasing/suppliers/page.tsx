import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listSuppliers } from "@/lib/queries/purchasing";
import { SuppliersTable } from "./suppliers-table";

export const metadata = { title: "Suppliers · Café POS" };

export default async function SuppliersPage({ searchParams }: PageProps<"/purchasing/suppliers">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "purchasing.view")) return <AccessDenied permission="purchasing.view" />;
  const showInactive = (await searchParams).show === "all";
  const suppliers = await listSuppliers(ctx, { includeInactive: showInactive });
  const canEdit = hasPermission(ctx, ctx.branchId, "purchasing.receive") || hasPermission(ctx, ctx.branchId, "purchasing.pay");
  return (
    <>
      <PageHeader title="Suppliers" description="Amounts owed and credit are for this branch." />
      <SuppliersTable suppliers={suppliers} canEdit={canEdit} showInactive={showInactive} />
    </>
  );
}
