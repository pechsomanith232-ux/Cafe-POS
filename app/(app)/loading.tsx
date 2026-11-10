import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a back-office page loads (first load and every navigation). */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
