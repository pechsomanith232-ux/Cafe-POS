"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { AgingBuckets } from "@/lib/domain/aging";

export function AgingCsv({ rows, asOf }: { rows: ({ supplierName: string } & AgingBuckets)[]; asOf: string }) {
  return (
    <Button type="button" variant="outline" className="ml-auto" onClick={() => downloadCsv(`ap-aging-${asOf}.csv`, toCsv(rows, [
      { header: "Supplier", value: (r) => r.supplierName }, { header: "Current", value: (r) => r.current }, { header: "1-30", value: (r) => r.d1_30 },
      { header: "31-60", value: (r) => r.d31_60 }, { header: "61-90", value: (r) => r.d61_90 }, { header: "90+", value: (r) => r.d90_plus }, { header: "Total", value: (r) => r.total },
    ]))}>
      <Download /> CSV
    </Button>
  );
}
