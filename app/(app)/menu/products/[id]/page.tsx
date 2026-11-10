import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { BranchPricesCard, ComboCostCard, ProductImageCard } from "@/components/menu/product-extras";
import { ProductForm } from "@/components/menu/product-form";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { canManageMenu, canViewMenu } from "@/lib/menu-access";
import { canSeeCost, getModifierGroup, getProduct, listMenuCategories, listModifierGroups, listRecipeItems, recipeItemIds } from "@/lib/queries/menu";
import { getStorage } from "@/lib/storage";

export default async function ProductPage({ params }: PageProps<"/menu/products/[id]">) {
  const ctx = await getContext();
  if (!canViewMenu(ctx)) return <AccessDenied permission="menu.view" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const product = await getProduct(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [categories, groups, items, attached] = await Promise.all([
    listMenuCategories(ctx, { includeInactive: true }), listModifierGroups(ctx), listRecipeItems(ctx, { includeItemIds: recipeItemIds(product.variants) }),
    Promise.all(product.modifierGroupIds.map((g) => getModifierGroup(ctx, g))),
  ]);
  const imageUrl = product.imageKey ? await getStorage().url(product.imageKey) : null;
  const canEdit = canManageMenu(ctx);
  const showCost = canSeeCost(ctx);
  const branch = ctx.access.get(ctx.branchId)!;
  return (
    <>
      <PageHeader title={product.name} description={showCost ? `Costs use average ingredient costs at ${branch.branchName}.` : undefined} />
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ProductImageCard productId={product.id} imageUrl={imageUrl} canEdit={canEdit} />
          <BranchPricesCard product={product} branchId={ctx.branchId} branchLabel={branch.branchName} canEdit={canEdit} />
        </div>
        {showCost && <ComboCostCard product={product} groups={attached.filter((g) => g.isActive)} />}
        <ProductForm key={product.updatedAt.toISOString()} product={product} categories={categories} groups={groups} items={items} showCost={showCost} canEdit={canEdit} />
      </div>
    </>
  );
}
