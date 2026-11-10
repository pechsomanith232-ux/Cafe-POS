import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { lowStock } from "@/lib/queries/inventory";

// GET /api/inventory/low-stock — sidebar badge, polled every 30 s (plan §1, §4.12).
export async function GET(): Promise<Response> {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "inventory.view")) {
    return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const { count } = await lowStock(ctx, ctx.branchId);
  return Response.json({ branchId: ctx.branchId, count }, { headers: { "Cache-Control": "no-store" } });
}
