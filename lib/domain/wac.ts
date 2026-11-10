import Decimal from "decimal.js";
import { dec, toCostString, toMoneyString, toQtyString, type DecInput } from "./money";

// Weighted average cost per item per branch (plan §4.2). Pure maths, used by
// applyStockMovement. All values are strings in DB precision.

export const MOVEMENT_TYPES = [
  "opening", "purchase", "purchase_return", "sale", "refund_restock", "adjustment_in",
  "adjustment_out", "waste", "count_adjustment", "transfer_out", "transfer_in",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

type Rule = {
  /** Required sign of qty_base. */
  sign: "+" | "-" | "any";
  /** How the movement is valued. */
  cost: "required" | "optional" | "avg" | "receipt";
};

const RULES: Record<MovementType, Rule> = {
  opening: { sign: "+", cost: "required" },
  purchase: { sign: "+", cost: "required" },
  transfer_in: { sign: "+", cost: "required" }, // sender's avg
  refund_restock: { sign: "+", cost: "required" }, // original sale cost
  adjustment_in: { sign: "+", cost: "optional" }, // no cost → current avg
  purchase_return: { sign: "-", cost: "receipt" }, // out at receipt cost
  sale: { sign: "-", cost: "avg" },
  adjustment_out: { sign: "-", cost: "avg" },
  waste: { sign: "-", cost: "avg" },
  transfer_out: { sign: "-", cost: "avg" },
  count_adjustment: { sign: "any", cost: "avg" },
};

export type StockState = { qty: DecInput; avg: DecInput };
export type MovementInput = {
  type: MovementType;
  qtyBase: DecInput;
  unitCost?: DecInput | null;
  /**
   * Exact value of an inbound movement (e.g. 10 cases × $20 = $200). When given,
   * it is used for total_cost and the average instead of a rounded unit cost,
   * so stock value matches what was paid.
   */
  totalCost?: DecInput | null;
};
export type MovementResult = { qtyAfter: string; avgAfter: string; unitCost: string; totalCost: string };

export function computeMovement(state: StockState, input: MovementInput): MovementResult {
  const rule = RULES[input.type];
  if (!rule) throw new Error(`Unknown movement type: ${input.type}`);
  const q = dec(input.qtyBase);
  if (q.isZero()) throw new Error("Movement quantity can't be zero.");
  if (rule.sign === "+" && q.isNegative()) throw new Error(`${input.type} quantity must be positive.`);
  if (rule.sign === "-" && q.isPositive()) throw new Error(`${input.type} quantity must be negative.`);

  const onHand = dec(state.qty);
  const avg = dec(toCostString(state.avg));
  const totalIn = input.totalCost == null || input.totalCost === "" ? null : dec(input.totalCost);
  if (totalIn !== null) {
    const inboundWithCost = q.isPositive() && rule.cost !== "avg" && rule.cost !== "receipt";
    if (!inboundWithCost && rule.cost !== "receipt") {
      throw new Error("A total cost can only be given for inbound movements with a cost, or supplier returns.");
    }
    if (totalIn.isNegative()) throw new Error("Total cost can't be negative (give the value as a positive amount).");
  }
  const given =
    totalIn !== null ? totalIn.div(q.abs()) : input.unitCost == null || input.unitCost === "" ? null : dec(input.unitCost);
  if (given?.isNegative()) throw new Error("Unit cost can't be negative.");
  if ((rule.cost === "required" || rule.cost === "receipt") && given === null) {
    throw new Error(`${input.type} needs a unit cost.`);
  }

  const qtyAfter = onHand.plus(q);
  let unitCost = avg;
  let newAvg = avg;

  if (q.isPositive() && given !== null && rule.cost !== "avg") {
    // Inbound with cost: weighted average, or the incoming cost if stock was ≤ 0.
    unitCost = given;
    const valueIn = totalIn ?? q.times(given);
    newAvg = onHand.lte(0) ? valueIn.div(q) : onHand.times(avg).plus(valueIn).div(qtyAfter);
  } else if (rule.cost === "receipt" && given !== null) {
    // Out at a specific cost (supplier return): re-average what's left.
    unitCost = given;
    const valueOut = totalIn ?? q.abs().times(given);
    if (qtyAfter.gt(0)) newAvg = onHand.times(avg).minus(valueOut).div(qtyAfter);
    if (newAvg.isNegative()) newAvg = new Decimal(0);
  }
  // Otherwise (outbound, or inbound without cost) the movement is valued at the
  // current avg and the avg doesn't change.

  const unitCostStr = toCostString(unitCost);
  return {
    qtyAfter: toQtyString(qtyAfter),
    avgAfter: toCostString(newAvg),
    unitCost: unitCostStr,
    totalCost: toMoneyString(totalIn !== null ? (q.isNegative() ? totalIn.neg() : totalIn) : q.times(dec(unitCostStr))),
  };
}
