/** Today's date in the café's time zone as yyyy-mm-dd. */
export function todayLocal(timeZone = "Asia/Phnom_Penh"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** yyyy-mm-dd + n days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True for a real yyyy-mm-dd calendar date (rejects 2026-02-30). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`); // invalid days are either NaN or roll over, depending on the engine
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
