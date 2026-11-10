import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ModifierGroupForm } from "@/components/menu/modifier-group-form";
import { getContext } from "@/lib/context";
import { canManageMenu } from "@/lib/menu-access";
import { canSeeCost, listRecipeItems } from "@/lib/queries/menu";

export const metadata = { title: "New modifier group · Café POS" };

export default async function NewModifierGroupPage() {
  const ctx = await getContext();
  if (!canManageMenu(ctx)) return <AccessDenied permission="menu.manage" />;
  const items = await listRecipeItems(ctx);
  return (
    <>
      <PageHeader title="New modifier group" description="e.g. Milk (choose up to 1): Oat milk +$0.50 uses 200 ml oat milk instead of 200 ml fresh milk." />
      <ModifierGroupForm items={items} showCost={canSeeCost(ctx)} canEdit />
    </>
  );
}
