import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ItemForm } from "@/components/inventory/item-form";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { getItem, listCategories } from "@/lib/queries/inventory";
import { getItemSale, listMenuCategories } from "@/lib/queries/menu";
import { ItemSaleCard } from "@/components/inventory/item-sale-card";
import { BranchStock } from "./branch-stock";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export default async function ItemPage({ params }: PageProps<"/[locale]/inventory/items/[id]">) {
  const { id, locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.view")) return <AccessDenied permission="inventory.view" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const item = await getItem(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const canManage = hasPermission(ctx, ctx.branchId, "inventory.manage_items");
  const categories = (await listCategories(ctx)).filter((c) => c.isActive || c.id === item.categoryId);
  // Sell on POS sets a menu price, so it needs menu.manage.
  const canSell = hasPermission(ctx, ctx.branchId, "menu.manage");
  const [sale, menuCategories] = canSell ? await Promise.all([getItemSale(ctx, item.id), listMenuCategories(ctx)]) : [null, []];

  return (
    <>
      <PageHeader
        title={item.name}
        description={`Stock kept in ${item.baseUnit}${item.sku ? ` · SKU ${item.sku}` : ""}`}
        actions={<Button asChild variant="outline"><Link href={`/inventory/movements?item=${item.id}`}>Movement history</Link></Button>}
      />
      <div className="grid max-w-5xl gap-6">
        <BranchStock item={item} />
        {canManage ? (
          <ItemForm
            item={{
              id: item.id,
              isActive: item.isActive,
              name: item.name,
              sku: item.sku ?? "",
              categoryId: item.categoryId,
              baseUnitCode: item.baseUnit as "ml",
              itemType: item.itemType as "ingredient",
              units: item.units.map((u) => ({
                id: u.id,
                name: u.name,
                factor: String(Number(u.factorToBase)),
                isPurchaseDefault: u.isPurchaseDefault,
                isCountDefault: u.isCountDefault,
              })),
            }}
            categories={categories}
            baseUnitLocked={item.hasMovements}
          />
        ) : null}
        {canSell && (
          <ItemSaleCard
            itemId={item.id}
            sale={sale}
            categories={menuCategories.map((c) => ({ id: c.id, name: c.name }))}
            unitOptions={item.unitOptions.map((u) => ({ key: u.key, label: u.label }))}
          />
        )}
      </div>
    </>
  );
}
