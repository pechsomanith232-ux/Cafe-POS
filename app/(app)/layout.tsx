import { Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import Loading from "./loading";
import { Skeleton } from "@/components/ui/skeleton";

// The frame renders instantly; the sidebar (needs the session) and the page
// stream in behind Suspense boundaries (Cache Components, see Next.js docs).
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:block print:hidden">
        <Suspense fallback={<SidebarSkeleton />}>
          <AppSidebar />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="print:hidden">
          <Suspense fallback={null}>
            <AppSidebar variant="mobile" />
          </Suspense>
        </div>
        <main className="flex-1 p-4 md:p-8 print:p-0">
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
