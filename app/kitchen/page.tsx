import { eq } from "drizzle-orm";
import { branches } from "@/db/schema";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { readBranchSettings } from "@/lib/branch-settings";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";

export default async function KitchenPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "pos.sell")) return <div className="p-8"><AccessDenied permission="pos.sell" /></div>;
  const branch = ctx.access.get(ctx.branchId)!;
  const [b] = await ctx.db.select({ settings: branches.settings }).from(branches).where(eq(branches.id, ctx.branchId));
  if (!readBranchSettings(b.settings).kitchenEnabled) return <div className="p-8 text-sm">The kitchen screen is turned off for this branch. Turn it on in Settings → POS settings.</div>;
  return <KitchenBoard branchId={ctx.branchId} branchName={branch.branchName} />;
}
