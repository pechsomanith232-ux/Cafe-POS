import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, discountReasons, exchangeRates, paymentMethods, registers } from "@/db/schema";

/** §12 default until the owner changes it in Settings: 4,100 riel per USD. */
export const DEFAULT_KHR_RATE = "4100";

/** Every branch gets a register, a KHR rate and its own payment methods (idempotent). Used by the seed, createBranch and tests. */
export async function ensureBranchDefaults(tx: Executor, branchId: string) {
  const [reg] = await tx.select({ id: registers.id }).from(registers).where(eq(registers.branchId, branchId)).limit(1);
  if (!reg) await tx.insert(registers).values({ branchId, name: "Register 1" });
  const [rate] = await tx.select({ id: exchangeRates.id }).from(exchangeRates)
    .where(and(eq(exchangeRates.branchId, branchId), eq(exchangeRates.currencyCode, "KHR"))).limit(1);
  if (!rate) await tx.insert(exchangeRates).values({ branchId, currencyCode: "KHR", rateToBase: DEFAULT_KHR_RATE });
  const [b] = await tx.select({ orgId: branches.orgId }).from(branches).where(eq(branches.id, branchId));
  const methods: [string, string][] = [["Cash", "cash"], ["KHQR", "khqr"], ["Bank transfer", "bank_transfer"], ["Card", "card"], ["Charge to account", "account"]];
  await tx.insert(paymentMethods).values(methods.map(([name, type]) => ({ orgId: b.orgId, branchId, name, type }))).onConflictDoNothing();
}

/** Common discount reasons for a new organization (idempotent). */
export async function ensureOrgDefaults(tx: Executor, orgId: string) {
  await tx.insert(discountReasons)
    .values(["Staff", "Promotion", "Regular customer", "Complaint"].map((name) => ({ orgId, name })))
    .onConflictDoNothing();
}
