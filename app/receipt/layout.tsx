import { Suspense } from "react";

export const metadata = { title: "Receipt · Café POS" };

// 80 mm thermal paper (plan §6). Screen view is a narrow preview of the same layout.
export default function ReceiptLayout({ children }: LayoutProps<"/receipt">) {
  return (
    <>
      <style>{`@page { size: 80mm auto; margin: 0 } @media print { body { background: white } .no-print { display: none } }`}</style>
      <Suspense fallback={null}>{children}</Suspense>
    </>
  );
}
