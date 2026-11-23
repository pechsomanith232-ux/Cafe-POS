"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TogglePills } from "@/components/ui/toggle-pills";
import { DailySalesChart } from "./daily-sales-chart";

type Point = { date: string; netSales: string; orders: number };

/** Dashboard trend card: title and 7/30-day switch on one header row, chart below. */
export function SalesTrend({ series7, series30 }: { series7: Point[]; series30: Point[] }) {
  const [days, setDays] = useState<"7" | "30">("7");
  const t = useTranslations("Dashboard.trend");
  const title = t("title", { days });
  return (
    <Card className="mb-6 gap-4">
      <CardHeader className="items-center">
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{title}</CardDescription>
        <CardAction>
          <TogglePills size="sm" unselected="ghost" className="gap-1 rounded-lg bg-muted p-1" value={days} onValueChange={setDays}
            aria-label={t("range")} options={(["7", "30"] as const).map((d) => ({ value: d, label: t("days", { days: d }) }))} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DailySalesChart captionHidden title={title} data={days === "7" ? series7 : series30} />
      </CardContent>
    </Card>
  );
}
