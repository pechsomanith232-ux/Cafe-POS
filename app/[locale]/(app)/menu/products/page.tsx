import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { canManageMenu, canViewMenu } from "@/lib/menu-access";
import { listProducts } from "@/lib/queries/menu";
import { getStorage } from "@/lib/storage";
import { ProductsTable } from "./products-table";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Products · Café POS" };

export default async function ProductsPage({ params }: PageProps<"/[locale]/menu/products">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  if (!canViewMenu(ctx)) return <AccessDenied permission="menu.view" />;
  const rows = await listProducts(ctx);
  const storage = getStorage();
  const withImages = await Promise.all(rows.map(async (r) => ({ ...r, imageUrl: r.imageKey ? await storage.url(r.imageKey) : null })));
  return (
    <>
      <PageHeader title="Products" description="What you sell: variants, prices, modifier groups and recipes." />
      <ProductsTable rows={withImages} canEdit={canManageMenu(ctx)} />
    </>
  );
}
