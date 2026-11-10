import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ForbiddenError } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { getCount } from "@/lib/queries/inventory";
import { CountSheet } from "./count-sheet";

export default async function CountPage({ params }: PageProps<"/inventory/counts/[id]">) {
  const ctx = await getContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const count = await getCount(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!count) return <AccessDenied permission="inventory.count" />;
  const status = { draft: "In progress", posted: "Posted", cancelled: "Cancelled" }[count.status] ?? count.status;
  return (
    <>
      <PageHeader
        title="Stock count"
        description={`Started ${fmtDateTime(count.createdAt)}. Posting sets stock to the counted amounts.`}
        actions={<Badge variant={count.status === "draft" ? "outline" : "secondary"}>{status}</Badge>}
      />
      <CountSheet count={count} />
    </>
  );
}
