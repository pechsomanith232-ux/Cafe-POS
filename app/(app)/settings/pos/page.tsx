import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { branches } from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { currentRate, listAllPaymentMethods, listDiningTables, listExchangeRateHistory } from "@/lib/queries/pos";
import { PosSettings } from "./pos-settings";

export const metadata = { title: "POS settings · Café POS" };

export default async function PosSettingsPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "settings.manage")) return <AccessDenied permission="settings.manage" />;
  const [tables, rate, history, methods, [branchRow]] = await Promise.all([
    listDiningTables(ctx, ctx.branchId, { includeInactive: true }), currentRate(ctx, ctx.branchId, "KHR"), listExchangeRateHistory(ctx, ctx.branchId),
    listAllPaymentMethods(ctx), ctx.db.select().from(branches).where(eq(branches.id, ctx.branchId)),
  ]);
  const branch = ctx.access.get(ctx.branchId)!;
  return (
    <>
      <PageHeader title="POS settings" description={`Tables, exchange rate, payment methods and cash-drawer rules for ${branch.branchName}. Tax settings are on the Branches page.`} />
      <PosSettings branchId={ctx.branchId} tables={tables} khrRate={rate} history={history.map((h) => ({ ...h, effectiveFrom: h.effectiveFrom.toISOString() }))}
        methods={methods.map((m) => ({ id: m.id, name: m.name, type: m.type, isActive: m.isActive }))} settings={readBranchSettings(branchRow.settings)} />
    </>
  );
}
