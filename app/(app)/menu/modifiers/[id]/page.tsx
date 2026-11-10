import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ModifierGroupForm } from "@/components/menu/modifier-group-form";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { canManageMenu, canViewMenu } from "@/lib/menu-access";
import { canSeeCost, getModifierGroup, listRecipeItems, recipeItemIds } from "@/lib/queries/menu";

export default async function ModifierGroupPage({ params }: PageProps<"/menu/modifiers/[id]">) {
  const ctx = await getContext();
  if (!canViewMenu(ctx)) return <AccessDenied permission="menu.view" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const group = await getModifierGroup(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const items = await listRecipeItems(ctx, { includeItemIds: recipeItemIds(group.modifiers) });
  return (
    <>
      <PageHeader title={group.name} description="Changes apply to future sales only." />
      <ModifierGroupForm key={group.updatedAt.toISOString()} group={group} items={items} showCost={canSeeCost(ctx)} canEdit={canManageMenu(ctx)} />
    </>
  );
}
