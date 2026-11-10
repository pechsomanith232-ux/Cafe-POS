import { notFound } from "next/navigation";
import { DraftActions, ReceiveForm } from "@/components/inventory/transfer-actions";
import { NotFoundError } from "@/lib/errors";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getContext } from "@/lib/context";
import { fmtDateTime, usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { getTransfer } from "@/lib/queries/inventory";
import { STATUS } from "../page";

export default async function TransferPage({ params }: PageProps<"/inventory/transfers/[id]">) {
  const ctx = await getContext();
  if (!ctx.branchIds.some((b) => hasPermission(ctx, b, "inventory.transfer"))) return <AccessDenied permission="inventory.transfer" />;
  const t = await getTransfer(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const canSend = t.status === "draft" && hasPermission(ctx, t.fromBranchId, "inventory.transfer");
  const canReceive = t.status === "sent" && hasPermission(ctx, t.toBranchId, "inventory.transfer");
  return (
    <>
      <PageHeader title={`Transfer ${t.ref}`} description={`${t.fromBranch} → ${t.toBranch} · ${STATUS[t.status]}`} actions={canSend ? <DraftActions id={t.id} /> : null} />
      <p className="mb-4 text-sm text-muted-foreground">
        Created {fmtDateTime(new Date(t.createdAt))}{t.sentAt && ` · sent ${fmtDateTime(new Date(t.sentAt))}`}{t.receivedAt && ` · received ${fmtDateTime(new Date(t.receivedAt))}`}
        {t.note && ` · ${t.note}`}{t.status === "received" && ` · value ${usd(t.valueSent, 4)}, loss ${usd(t.lossValue, 4)}`}
      </p>
      {canReceive && <Card className="mb-4 max-w-2xl"><CardContent className="pt-6"><ReceiveForm id={t.id} lines={t.lines} /></CardContent></Card>}
      {t.status === "sent" && !canReceive && <p className="mb-4 text-sm">On the way — {t.toBranch} receives it.</p>}
      <ReportTable filename={`${t.ref}.csv`} data={t.lines} columns={[
        { key: "item", header: "Item" }, { key: "enteredQty", header: "Entered", kind: "qty" }, { key: "enteredUnitLabel", header: "Unit" },
        { key: "qtySent", header: "Sent (base)", kind: "qty" }, { key: "qtyReceived", header: "Received", kind: "qty" }, { key: "unit", header: "Base unit" },
        { key: "unitCost", header: "Unit cost", kind: "unitCost" }, // 4 decimals so sent = received + loss adds up on screen.
        { key: "valueSent", header: "Value sent", kind: "unitCost" },
        { key: "valueReceived", header: "Value received", kind: "unitCost" }, { key: "lossValue", header: "Loss", kind: "unitCost" },
      ]} />
    </>
  );
}
