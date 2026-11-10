import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { currencies } from "@/db/schema";
import type { SettleCurrency } from "@/lib/domain/currency";
import { ValidationError } from "@/lib/errors";

/** Currency with the branch's current rate (USD = 1). */
export async function currencyAt(tx: Executor, branchId: string, code: string): Promise<SettleCurrency> {
  const [c] = await tx.select().from(currencies).where(eq(currencies.code, code));
  if (!c) throw new ValidationError(`Unknown currency ${code}.`);
  if (code === "USD") return { code, decimals: c.decimals, cashRounding: c.cashRounding, rate: "1" };
  const r = await tx.execute<{ rate: string }>(sql`
    select rate_to_base::text as rate from exchange_rates
    where branch_id = ${branchId} and currency_code = ${code} and effective_from <= now()
    order by effective_from desc, created_at desc limit 1`);
  const rate = r[0]?.rate;
  if (!rate) throw new ValidationError(`No exchange rate for ${code} at this branch. Set it in Settings → POS settings.`);
  return { code, decimals: c.decimals, cashRounding: c.cashRounding, rate };
}

