import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { fmtDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { listCategories, listCounts } from "@/lib/queries/inventory";
import { StartCount } from "./start-count";

export const metadata = { title: "Stock counts · Café POS" };
const STATUS: Record<string, string> = { draft: "In progress", posted: "Posted", cancelled: "Cancelled" };

export default async function CountsPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.count")) return <AccessDenied permission="inventory.count" />;
  const [rows, categories] = await Promise.all([listCounts(ctx, ctx.branchId), listCategories(ctx)]);
  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Count what's on the shelf; posting corrects stock to the counted amounts."
        actions={<StartCount branchId={ctx.branchId} categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} />}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Counted</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell><Link className="hover:underline" href={`/inventory/counts/${c.id}`}>{fmtDateTime(c.createdAt)}</Link></TableCell>
                <TableCell>{c.categoryName ?? "All items"}</TableCell>
                <TableCell>{c.counted} / {c.lines}</TableCell>
                <TableCell>{c.createdByName ?? "—"}</TableCell>
                <TableCell><Badge variant={c.status === "draft" ? "outline" : "secondary"}>{STATUS[c.status]}</Badge></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No counts yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
