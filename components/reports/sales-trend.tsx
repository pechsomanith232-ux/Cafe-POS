"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DailySalesChart } from "./daily-sales-chart";

type Point = { date: string; netSales: string; orders: number };

/** Dashboard trend: daily net sales for the last 7 or 30 days. */
export function SalesTrend({ series7, series30 }: { series7: Point[]; series30: Point[] }) {
  const [days, setDays] = useState<7 | 30>(7);
  return (
    <div className="grid gap-2">
      <div className="flex justify-end gap-1">
        {([7, 30] as const).map((d) => (
          <Button key={d} size="sm" variant={days === d ? "secondary" : "ghost"} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</Button>
        ))}
      </div>
      <DailySalesChart title={`Net sales after refunds, last ${days} days`} data={days === 7 ? series7 : series30} />
    </div>
  );
}
