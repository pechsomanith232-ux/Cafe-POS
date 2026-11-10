import { dec, sum, toMoneyString, type DecInput } from "./money";

/**
 * Allocate extra costs (delivery etc.) to receipt lines by line value
 * (plan §4.9). Parts are rounded to 4 dp and the rounding difference goes to
 * the largest line, so the parts always add up to the extra cost exactly.
 * If every line is free, the extra cost is split evenly.
 */
export function allocateExtraCosts(lines: { lineTotal: DecInput }[], extra: DecInput) {
  const totalExtra = dec(extra);
  const values = lines.map((l) => dec(l.lineTotal));
  const base = sum(values);
  const raw = values.map((v) =>
    base.isZero() ? totalExtra.div(lines.length || 1) : totalExtra.times(v).div(base),
  );
  const parts = raw.map((r) => r.toDecimalPlaces(4));
  const diff = totalExtra.minus(sum(parts));
  if (!diff.isZero() && parts.length) {
    // Give the rounding remainder to the line with the largest value (last such line on ties).
    let idx = 0;
    values.forEach((v, i) => { if (v.gte(values[idx])) idx = i; });
    parts[idx] = parts[idx].plus(diff);
  }
  return parts.map((p, i) => ({ allocated: toMoneyString(p), landedTotal: toMoneyString(values[i].plus(p)) }));
}
