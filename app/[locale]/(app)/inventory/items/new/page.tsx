import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ItemForm } from "@/components/inventory/item-form";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listCategories } from "@/lib/queries/inventory";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "New item · Café POS" };

export default async function NewItemPage({ params }: PageProps<"/[locale]/inventory/items/new">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.manage_items")) return <AccessDenied permission="inventory.manage_items" />;
  const categories = (await listCategories(ctx)).filter((c) => c.isActive);
  return (
    <>
      <PageHeader title="New item" description="An ingredient, packaging or product you keep in stock." />
      <div className="max-w-3xl"><ItemForm categories={categories} /></div>
    </>
  );
}
