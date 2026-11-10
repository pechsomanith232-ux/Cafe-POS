import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/menu/product-form";
import { getContext } from "@/lib/context";
import { canManageMenu } from "@/lib/menu-access";
import { canSeeCost, listMenuCategories, listModifierGroups, listRecipeItems } from "@/lib/queries/menu";

export const metadata = { title: "New product · Café POS" };

export default async function NewProductPage() {
  const ctx = await getContext();
  if (!canManageMenu(ctx)) return <AccessDenied permission="menu.manage" />;
  const [categories, groups, items] = await Promise.all([listMenuCategories(ctx), listModifierGroups(ctx), listRecipeItems(ctx)]);
  return (
    <>
      <PageHeader title="New product" description="Add the variants you sell (e.g. Regular, Large) with a recipe for each, so stock is used up when it's sold." />
      <ProductForm categories={categories} groups={groups} items={items} showCost={canSeeCost(ctx)} canEdit />
    </>
  );
}
