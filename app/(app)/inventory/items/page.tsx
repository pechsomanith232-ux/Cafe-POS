import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listCategories, listItems } from "@/lib/queries/inventory";
import { ItemsTable } from "./items-table";

export const metadata = { title: "Items & stock · Café POS" };

export default async function ItemsPage({ searchParams }: PageProps<"/inventory/items">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.view")) return <AccessDenied permission="inventory.view" />;
  const sp = await searchParams;
  const lowOnly = sp.filter === "low";
  const showInactive = sp.show === "all";
  const [items, categories] = await Promise.all([
    listItems(ctx, { branchId: ctx.branchId, lowOnly, includeInactive: showInactive }),
    listCategories(ctx),
  ]);
  const branch = ctx.access.get(ctx.branchId)!;
  return (
    <>
      <PageHeader title="Items & stock" description={`Stock on hand at ${branch.branchCode} · ${branch.branchName}`} />
      <ItemsTable
        items={items}
        categories={categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
        lowOnly={lowOnly}
        showInactive={showInactive}
        canManage={hasPermission(ctx, ctx.branchId, "inventory.manage_items")}
        canSeeCost={hasPermission(ctx, ctx.branchId, "inventory.view_cost")}
      />
    </>
  );
}
