import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import { arAging } from "@/lib/queries/customers";
import { ArAgingTable } from "./ar-aging-table";

export const metadata = { title: "AR aging · Café POS" };

export default async function ArAgingPage({ searchParams }: PageProps<"/customers/aging">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "reports.ar")) return <AccessDenied permission="reports.ar" />;
  const sp = await searchParams;
  const asOf = typeof sp.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : todayLocal();
  const data = await arAging(ctx, { asOf });
  return (
    <>
      <PageHeader title="AR aging" description="What customers owe on their accounts, by days since the charge." />
      <ArAgingTable data={data} />
    </>
  );
}
