import { Suspense } from "react";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Receipt · Café POS" };

// 80 mm thermal paper (plan §6). Screen view is a narrow preview of the same layout.
export default async function ReceiptLayout({ params, children }: LayoutProps<"/[locale]/receipt">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  return (
    <>
      <style>{`@page { size: 80mm auto; margin: 0 } @media print { body { background: white } .no-print { display: none } }`}</style>
      <Suspense fallback={null}>{children}</Suspense>
    </>
  );
}
