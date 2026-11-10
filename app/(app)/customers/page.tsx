import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listCustomers } from "@/lib/queries/customers";
import { CustomersTable } from "./customers-table";

export const metadata = { title: "Customers · Café POS" };

export default async function CustomersPage() {
  const ctx = await getContext();
  const canManage = hasPermission(ctx, ctx.branchId, "customers.manage");
  if (!canManage && !hasPermission(ctx, ctx.branchId, "ar.receive_payment")) return <AccessDenied permission="customers.manage" />;
  const rows = await listCustomers(ctx, { includeInactive: true });
  return (
    <>
      <PageHeader title="Customers" description="Customers with a credit account can have orders charged at the POS and pay later." />
      <CustomersTable rows={rows} canManage={canManage} />
    </>
  );
}
