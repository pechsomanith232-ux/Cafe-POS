import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listAudit, type AuditFilters } from "@/lib/queries/settings";
import { AuditDetails } from "./audit-details";

export const metadata = { title: "Audit log · Café POS" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "audit.view")) return <AccessDenied permission="audit.view" />;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters: AuditFilters = {
    q: one(sp.q)?.slice(0, 100),
    from: DATE.test(one(sp.from) ?? "") ? one(sp.from) : undefined,
    to: DATE.test(one(sp.to) ?? "") ? one(sp.to) : undefined,
    page: Number(one(sp.page)) || 1,
  };
  const { rows, page, hasMore } = await listAudit(ctx, filters);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    params.set("page", String(p));
    return `/audit?${params}`;
  };

  return (
    <>
      <PageHeader title="Audit log" description="Every sensitive change: who, when, what changed, and who approved it." />
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/audit">
        <Input name="q" placeholder="Action, entity or reason" defaultValue={filters.q} className="w-64" />
        <label className="text-xs text-muted-foreground">From<Input type="date" name="from" defaultValue={filters.from} /></label>
        <label className="text-xs text-muted-foreground">To<Input type="date" name="to" defaultValue={filters.to} /></label>
        <Button type="submit" variant="outline">Filter</Button>
        <Button asChild variant="ghost"><Link href="/audit">Clear</Link></Button>
      </form>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Reason / approver</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {r.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", dateStyle: "short", timeStyle: "medium" })}
                </TableCell>
                <TableCell>{r.userName ?? "—"}</TableCell>
                <TableCell><span className="font-mono text-xs">{r.action}</span></TableCell>
                <TableCell>{r.branchCode ?? "All"}</TableCell>
                <TableCell className="text-sm">
                  {r.reason ?? ""}
                  {r.approverName && <div className="text-xs text-muted-foreground">Approved by {r.approverName}</div>}
                </TableCell>
                <TableCell><AuditDetails before={r.before} after={r.after} /></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nothing found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex justify-between">
        {page > 1 ? <Button asChild variant="outline"><Link href={pageHref(page - 1)}>Newer</Link></Button> : <span />}
        {hasMore && <Button asChild variant="outline"><Link href={pageHref(page + 1)}>Older</Link></Button>}
      </div>
    </>
  );
}
