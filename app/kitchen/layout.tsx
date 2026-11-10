import { Suspense } from "react";

export const metadata = { title: "Kitchen · Café POS" };

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading kitchen…</div>}>{children}</Suspense>;
}
