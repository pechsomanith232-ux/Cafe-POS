// Display helpers shared by pages.

const TZ = "Asia/Phnom_Penh";

export const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });

export const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: TZ });

/** Trim trailing zeros from a numeric string: "12.5000" → "12.5". */
export function num(v: string | number | null | undefined, maxDp = 4): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDp });
}

export function usd(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n < 0 ? "−" : ""}$${s}`;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening",
  purchase: "Purchase",
  purchase_return: "Supplier return",
  sale: "Sale",
  refund_restock: "Refund restock",
  adjustment_in: "Adjustment +",
  adjustment_out: "Adjustment −",
  waste: "Waste",
  count_adjustment: "Count",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
};

export const REASON_LABELS: Record<string, string> = {
  waste: "Waste",
  damage: "Damage",
  expired: "Expired",
  staff_meal: "Staff meal",
  correction: "Correction",
  other: "Other",
};
