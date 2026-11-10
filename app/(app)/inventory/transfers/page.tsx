import { Plus } from "lucide-react";
import Link from "next/link";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listTransfers } from "@/lib/queries/inventory";

export const metadata = { title: "Stock transfers · Café POS" };
export const STATUS: Record<string, string> = { draft: "Draft", sent: "On the way", received: "Received", cancelled: "Cancelled" };

export default async function TransfersPage() {
  const ctx = await getContext();
  if (!ctx.branchIds.some((b) => hasPermission(ctx, b, "inventory.transfer"))) return <AccessDenied permission="inventory.transfer" />;
  const rows = await listTransfers(ctx);
  return (
    <>
      <PageHeader title="Stock transfers" description="Send stock to another branch. It leaves when sent and arrives when the other branch receives it."
        actions={hasPermission(ctx, ctx.branchId, "inventory.transfer") ? <Button asChild><Link href="/inventory/transfers/new"><Plus /> New transfer</Link></Button> : null} />
      <ReportTable filename="transfers.csv" emptyText="No transfers yet." data={rows} columns={[
        { key: "ref", header: "Transfer", link: { prefix: "/inventory/transfers/", key: "id" } },
        { key: "createdAt", header: "Created", kind: "datetime" },
        { key: "fromBranch", header: "From" }, { key: "toBranch", header: "To" },
        { key: "status", header: "Status", labels: STATUS },
        { key: "lines", header: "Items", kind: "int" },
        { key: "valueSent", header: "Value sent", kind: "money" }, { key: "lossValue", header: "Loss", kind: "money" },
      ]} />
    </>
  );
}
