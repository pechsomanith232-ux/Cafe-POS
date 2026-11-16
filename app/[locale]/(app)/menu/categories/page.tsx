import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { canManageMenu, canViewMenu } from "@/lib/menu-access";
import { listMenuCategories } from "@/lib/queries/menu";
import { CategoriesTable } from "./categories-table";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Menu categories · Café POS" };

export default async function MenuCategoriesPage({ params }: PageProps<"/[locale]/menu/categories">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  if (!canViewMenu(ctx)) return <AccessDenied permission="menu.view" />;
  const rows = await listMenuCategories(ctx, { includeInactive: true });
  return (
    <>
      <PageHeader title="Menu categories" description="Tabs on the POS screen, in sort order." />
      <CategoriesTable rows={rows} canEdit={canManageMenu(ctx)} />
    </>
  );
}
