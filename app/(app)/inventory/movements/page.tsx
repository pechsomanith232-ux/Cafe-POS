import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { MOVEMENT_TYPES } from "@/lib/domain/wac";
import { hasPermission } from "@/lib/permissions";
import { listItemOptions, listMovements } from "@/lib/queries/inventory";
import { MovementsTable } from "./movements-table";

export const metadata = { title: "Stock movements · Café POS" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function MovementsPage({ searchParams }: PageProps<"/inventory/movements">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.view")) return <AccessDenied permission="inventory.view" />;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters = {
    itemId: UUID.test(one(sp.item) ?? "") ? one(sp.item) : undefined,
    type: (MOVEMENT_TYPES as readonly string[]).includes(one(sp.type) ?? "") ? one(sp.type) : undefined,
    from: DATE.test(one(sp.from) ?? "") ? one(sp.from) : undefined,
    to: DATE.test(one(sp.to) ?? "") ? one(sp.to) : undefined,
    page: Number(one(sp.page)) || 1,
  };
  const [{ rows, page, hasMore }, itemOptions] = await Promise.all([
    listMovements(ctx, { branchId: ctx.branchId, ...filters }),
    listItemOptions(ctx),
  ]);
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ item: filters.itemId, type: filters.type, from: filters.from, to: filters.to })) if (v) q.set(k, v);
    q.set("page", String(p));
    return `/inventory/movements?${q}`;
  };
  return (
    <>
      <PageHeader title="Stock movements" description="Every change to stock at this branch. Balance = stock of that item right after the movement." />
      <MovementsTable
        rows={rows}
        items={itemOptions.map((i) => ({ id: i.id, name: i.name }))}
        filters={filters}
        showCost={hasPermission(ctx, ctx.branchId, "inventory.view_cost")}
      />
      <div className="mt-4 flex justify-between">
        {page > 1 ? <Button asChild variant="outline"><Link href={href(page - 1)}>Newer</Link></Button> : <span />}
        {hasMore && <Button asChild variant="outline"><Link href={href(page + 1)}>Older</Link></Button>}
      </div>
    </>
  );
}
