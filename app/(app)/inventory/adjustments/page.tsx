import { Plus } from "lucide-react";
import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { fmtDateTime, REASON_LABELS } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { listAdjustments } from "@/lib/queries/inventory";

export const metadata = { title: "Stock adjustments · Café POS" };

export default async function AdjustmentsPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.adjust")) return <AccessDenied permission="inventory.adjust" />;
  const rows = await listAdjustments(ctx, ctx.branchId);
  return (
    <>
      <PageHeader
        title="Stock adjustments"
        description="Waste, damage, staff meals and corrections. Drafts change nothing until posted."
        actions={<Button asChild><Link href="/inventory/adjustments/new"><Plus /> New adjustment</Link></Button>}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell><Link className="hover:underline" href={`/inventory/adjustments/${a.id}`}>{fmtDateTime(a.createdAt)}</Link></TableCell>
                <TableCell>{REASON_LABELS[a.reasonCode] ?? a.reasonCode}</TableCell>
                <TableCell className="max-w-64 truncate">{a.note ?? "—"}</TableCell>
                <TableCell>{a.lineCount}</TableCell>
                <TableCell>{a.createdByName ?? "—"}</TableCell>
                <TableCell><Badge variant={a.status === "posted" ? "secondary" : "outline"}>{a.status === "posted" ? "Posted" : "Draft"}</Badge></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No adjustments yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
