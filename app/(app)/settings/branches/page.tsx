import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listBranches } from "@/lib/queries/settings";
import { BranchesManager } from "./branches-manager";

export const metadata = { title: "Branches · Café POS" };

export default async function BranchesPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "settings.manage")) return <AccessDenied permission="settings.manage" />;
  const branches = await listBranches(ctx);
  return (
    <>
      <PageHeader title="Branches" description="Locations, receipt text and tax settings." />
      <BranchesManager branches={branches} />
    </>
  );
}
