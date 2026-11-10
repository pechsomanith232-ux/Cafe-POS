"use client";

import { useQuery } from "@tanstack/react-query";

/** Live count of items at or below their reorder level at the active branch. */
export function LowStockBadge({ branchId }: { branchId: string }) {
  const { data } = useQuery({
    queryKey: ["low-stock", branchId],
    queryFn: async () => {
      const res = await fetch("/api/inventory/low-stock", { cache: "no-store" });
      if (!res.ok) return { count: 0 };
      return (await res.json()) as { count: number };
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
  if (!data?.count) return null;
  return (
    <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white" aria-label={`${data.count} items low on stock`}>
      {data.count}
    </span>
  );
}
