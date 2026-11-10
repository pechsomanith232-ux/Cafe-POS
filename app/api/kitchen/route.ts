import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { branches } from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { getContext } from "@/lib/context";
import { ForbiddenError } from "@/lib/permissions";
import { listKitchenTickets } from "@/lib/queries/pos";

// Kitchen queue (plan §6), polled every 3 s by /kitchen. ?branch= defaults to the active branch.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const station = url.searchParams.get("station");
  try {
    const ctx = await getContext();
    const branchId = url.searchParams.get("branch") || ctx.branchId;
    const [b] = await ctx.db.select({ settings: branches.settings }).from(branches).where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)));
    if (b && !readBranchSettings(b.settings).kitchenEnabled) return NextResponse.json({ tickets: [], now: new Date().toISOString(), off: true }, { headers: { "Cache-Control": "no-store" } });
    const tickets = await listKitchenTickets(ctx, { branchId, station: station === "bar" || station === "kitchen" ? station : null });
    return NextResponse.json({ tickets, now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
