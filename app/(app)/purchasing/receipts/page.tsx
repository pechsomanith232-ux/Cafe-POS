import { Plus } from "lucide-react";
import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listReceipts } from "@/lib/queries/purchasing";
import { ReceiptsTable } from "./receipts-table";

export const metadata = { title: "Goods receipts · Café POS" };

export default async function ReceiptsPage({ searchParams }: PageProps<"/purchasing/receipts">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "purchasing.view")) return <AccessDenied permission="purchasing.view" />;
  const sp = await searchParams;
  const type = sp.type === "direct" || sp.type === "credit" ? sp.type : undefined;
  const rows = await listReceipts(ctx, { branchId: ctx.branchId, type });
  return (
    <>
      <PageHeader
        title="Goods receipts"
        description="Supplier invoices (credit) and pay-now purchases (direct) at this branch."
        actions={
          <div className="flex gap-2">
            {hasPermission(ctx, ctx.branchId, "purchasing.direct") && <Button asChild variant="outline"><Link href="/purchasing/receipts/new?type=direct">Quick purchase</Link></Button>}
            {hasPermission(ctx, ctx.branchId, "purchasing.receive") && <Button asChild><Link href="/purchasing/receipts/new?type=credit"><Plus /> New receipt</Link></Button>}
          </div>
        }
      />
      <ReceiptsTable rows={rows} type={type} />
    </>
  );
}
