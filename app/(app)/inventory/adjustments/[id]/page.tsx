import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { AdjustmentEditor } from "@/components/inventory/adjustment-editor";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { dec } from "@/lib/domain/money";
import { NotFoundError } from "@/lib/errors";
import { fmtDateTime, num, REASON_LABELS, usd } from "@/lib/format";
import { ForbiddenError, hasPermission } from "@/lib/permissions";
import { getAdjustment, listItemOptions } from "@/lib/queries/inventory";


export default async function AdjustmentPage({ params }: PageProps<"/inventory/adjustments/[id]">) {
  const ctx = await getContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const adj = await getAdjustment(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!adj) return <AccessDenied permission="inventory.adjust" />;
  const showCost = hasPermission(ctx, adj.branchId, "inventory.view_cost");

  if (adj.status === "draft") {
    const items = await listItemOptions(ctx);
    const draft = {
      id: adj.id,
      reasonCode: adj.reasonCode,
      note: adj.note,
      lines: adj.lines.map((l) => {
        const opt = items.find((i) => i.id === l.itemId)?.unitOptions.find((u) => u.label === l.enteredUnitLabel);
        // If the entered unit was renamed or removed since, fall back to the
        // stored base quantity so the amount never silently changes.
        if (!opt) {
          return { itemId: l.itemId, qty: l.qtyBase, unitKey: "base", unitCost: showCost && l.unitCost ? l.unitCost : "" };
        }
        const perEntered =
          l.totalCost && dec(l.enteredQty).abs().gt(0) ? dec(l.totalCost).div(dec(l.enteredQty).abs()) : l.unitCost ? dec(l.unitCost).times(opt.factor) : null;
        return {
          itemId: l.itemId,
          qty: l.enteredQty,
          unitKey: opt.key,
          unitCost: showCost && perEntered ? perEntered.toDecimalPlaces(6).toString() : "",
        };
      }),
    };
    return (
      <>
        <PageHeader title="Draft adjustment" description="Nothing has changed in stock yet. Post it to apply." />
        <div className="max-w-5xl"><AdjustmentEditor branchId={adj.branchId} items={items} draft={draft} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Adjustment · ${REASON_LABELS[adj.reasonCode] ?? adj.reasonCode}`}
        description={`Posted ${adj.postedAt ? fmtDateTime(adj.postedAt) : ""}${adj.note ? ` — ${adj.note}` : ""}`}
        actions={<Badge variant="secondary">Posted</Badge>}
      />
      <div className="max-w-3xl rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Entered</TableHead>
              <TableHead className="text-right">In base unit</TableHead>
              {showCost && <TableHead className="text-right">Cost given</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {adj.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.itemName}</TableCell>
                <TableCell className="text-right">{num(l.enteredQty)} {l.enteredUnitLabel}</TableCell>
                <TableCell className="text-right">{num(l.qtyBase)} {l.baseUnit}</TableCell>
                {showCost && <TableCell className="text-right">{l.unitCost ? `${usd(l.unitCost, 6)} / ${l.baseUnit}` : "avg"}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Posted adjustments can&apos;t be changed. To correct one, post a new adjustment.</p>
    </>
  );
}
