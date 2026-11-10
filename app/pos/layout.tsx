import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "POS · Café POS" };

// Full-screen POS (no sidebar). The page reads the session, so it streams in behind Suspense.
export default function PosLayout({ children }: LayoutProps<"/pos">) {
  return (
    <Suspense fallback={<div className="grid h-screen grid-cols-[1fr_380px] gap-3 p-3"><Skeleton className="h-full" /><Skeleton className="h-full" /></div>}>
      {children}
    </Suspense>
  );
}
