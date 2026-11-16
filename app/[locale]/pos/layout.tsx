import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "POS · Café POS" };

// Full-screen POS (no sidebar). The page reads the session, so it streams in behind Suspense.
export default async function PosLayout({ params, children }: LayoutProps<"/[locale]/pos">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  return (
    <Suspense fallback={<div className="grid h-screen grid-cols-[1fr_380px] gap-3 p-3"><Skeleton className="h-full" /><Skeleton className="h-full" /></div>}>
      {children}
    </Suspense>
  );
}
