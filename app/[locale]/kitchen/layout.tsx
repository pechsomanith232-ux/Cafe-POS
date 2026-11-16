import { Suspense } from "react";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Kitchen · Café POS" };

export default async function KitchenLayout({ params, children }: LayoutProps<"/[locale]/kitchen">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading kitchen…</div>}>{children}</Suspense>;
}
