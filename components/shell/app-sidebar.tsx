import { eq } from "drizzle-orm";
import { branches } from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { getContext } from "@/lib/context";
import { visibleNav } from "@/lib/nav";
import { SidebarNav, type SidebarData } from "./sidebar-nav";

/** Server part: loads the context and passes only plain data to the client. */
export async function AppSidebar({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const ctx = await getContext();
  const active = ctx.access.get(ctx.branchId)!;
  const [branch] = await ctx.db.select({ settings: branches.settings }).from(branches).where(eq(branches.id, ctx.branchId));
  const data: SidebarData = {
    userName: ctx.userName,
    roleName: active.roleName,
    branchId: ctx.branchId,
    branches: [...ctx.access.values()].map((b) => ({ id: b.branchId, code: b.branchCode, name: b.branchName })),
    groups: visibleNav(ctx, { kitchenEnabled: readBranchSettings(branch?.settings).kitchenEnabled }),
  };
  return <SidebarNav data={data} variant={variant} />;
}
