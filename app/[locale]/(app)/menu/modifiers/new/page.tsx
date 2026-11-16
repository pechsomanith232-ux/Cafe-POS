import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ModifierGroupForm } from "@/components/menu/modifier-group-form";
import { getContext } from "@/lib/context";
import { canManageMenu } from "@/lib/menu-access";
import { canSeeCost, listRecipeItems } from "@/lib/queries/menu";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "New modifier group · Café POS" };

export default async function NewModifierGroupPage({ params }: PageProps<"/[locale]/menu/modifiers/new">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
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
