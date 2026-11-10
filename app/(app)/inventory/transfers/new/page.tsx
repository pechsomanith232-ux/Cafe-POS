import { and, asc, eq, ne } from "drizzle-orm";
import { branches } from "@/db/schema";
import { TransferEditor } from "@/components/inventory/transfer-editor";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { itemOptionsFor } from "@/lib/queries/inventory";

export const metadata = { title: "New transfer · Café POS" };

export default async function NewTransferPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.transfer")) return <AccessDenied permission="inventory.transfer" />;
  const [items, targets] = await Promise.all([
    itemOptionsFor(ctx),
    ctx.db.select({ id: branches.id, name: branches.name }).from(branches)
      .where(and(eq(branches.orgId, ctx.orgId), eq(branches.isActive, true), ne(branches.id, ctx.branchId))).orderBy(asc(branches.name)),
  ]);
  const branch = ctx.access.get(ctx.branchId)!;
  return (
    <>
      <PageHeader title="New stock transfer" description={`From ${branch.branchCode} · ${branch.branchName}`} />
      {targets.length === 0
        ? <p className="text-sm text-muted-foreground">There&apos;s no other active branch to send to.</p>
        : <div className="max-w-4xl"><TransferEditor fromBranchId={ctx.branchId} targets={targets} items={items} /></div>}
    </>
  );
}
