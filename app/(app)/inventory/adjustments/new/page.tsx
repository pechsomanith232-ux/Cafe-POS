import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { AdjustmentEditor } from "@/components/inventory/adjustment-editor";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listItemOptions } from "@/lib/queries/inventory";

export const metadata = { title: "New adjustment · Café POS" };

export default async function NewAdjustmentPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.adjust")) return <AccessDenied permission="inventory.adjust" />;
  const items = await listItemOptions(ctx);
  const branch = ctx.access.get(ctx.branchId)!;
  return (
    <>
      <PageHeader title="New stock adjustment" description={`${branch.branchCode} · ${branch.branchName}`} />
      <div className="max-w-5xl"><AdjustmentEditor branchId={ctx.branchId} items={items} /></div>
    </>
  );
}
