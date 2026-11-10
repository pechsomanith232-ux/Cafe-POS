import { z } from "zod";
import { ORDER_TYPES } from "@/db/schema/pos";

const money = (label: string) =>
  z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label} must be a number of 0 or more with at most 4 decimals`);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const discountInput = z
  .object({ type: z.enum(["percent", "amount"]), value: money("Discount"), reason: optText(80) })
  .refine((d) => d.type !== "percent" || Number(d.value) <= 100, "A percent discount can't be more than 100%")
  .nullable()
  .default(null)
  // A zero discount is no discount.
  .transform((d) => (d && Number(d.value) > 0 ? d : null));

export const saveOrderInput = z.object({
  id: z.uuid().optional().nullable(),
  branchId: z.uuid(),
  registerId: z.uuid(),
  orderType: z.enum(ORDER_TYPES).default("takeaway"),
  tableId: z.uuid().optional().nullable(),
  note: optText(200),
  orderDiscount: discountInput,
  lines: z
    .array(z.object({
      id: z.uuid().optional(),
      variantId: z.uuid(),
      qty: z.number().int().min(1, "Quantity must be at least 1").max(999),
      modifierIds: z.array(z.uuid()).max(30).default([]),
      note: optText(200),
      discount: discountInput,
    }))
    .min(1, "Add at least one item")
    .max(100),
  approval: z.object({ approverId: z.string().min(1), pin: z.string().min(1).max(12) }).optional().nullable(),
  /** Hold or send to the kitchen in the same transaction. */
  then: z.enum(["hold", "send"]).optional().nullable(),
});
export type SaveOrderInput = z.input<typeof saveOrderInput>;

export const openShiftInput = z.object({
  branchId: z.uuid(),
  registerId: z.uuid(),
  floats: z.array(z.object({ currencyCode: z.string().min(3).max(3), amount: money("Opening float") })).max(5).default([]),
  notes: optText(300),
});
export type OpenShiftInput = z.input<typeof openShiftInput>;

export const closeShiftInput = z.object({
  counted: z.array(z.object({ currencyCode: z.string().min(3).max(3), amount: money("Counted cash") })).max(5).default([]),
  notes: optText(300),
  approval: z.object({ approverId: z.string().min(1), pin: z.string().min(1).max(12) }).optional().nullable(),
});
export type CloseShiftInput = z.input<typeof closeShiftInput>;

export const diningTableInput = z.object({
  branchId: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(30),
  area: optText(40),
  seats: z.number().int().min(1).max(99).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});
export type DiningTableInput = z.input<typeof diningTableInput>;

export const exchangeRateInput = z.object({
  branchId: z.uuid(),
  currencyCode: z.string().min(3).max(3),
  rate: money("Rate").refine((v) => Number(v) > 0, "Rate must be more than 0"),
});

export const kitchenStatusInput = z.enum(["pending", "preparing", "ready", "served"]);

const tender = z.object({ methodId: z.uuid(), currencyCode: z.string().length(3), amount: money("Amount").refine((v) => Number(v) > 0, "Amount must be more than 0"), reference: optText(80) });
export const payOrderInput = z.object({
  registerId: z.uuid(),
  /** May be empty only for a $0 order (e.g. a 100% staff discount). */
  tenders: z.array(tender).max(10),
  changeCurrency: z.string().length(3).default("USD"),
  customerId: z.uuid().optional().nullable(),
});
export type PayOrderInput = z.input<typeof payOrderInput>;

export const voidOrderInput = z.object({
  reason: z.string().trim().min(1, "Give a reason").max(200),
  approval: z.object({ approverId: z.string().min(1), pin: z.string().min(1).max(12) }),
});

export const refundOrderInput = z.object({
  registerId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason").max(200),
  approval: z.object({ approverId: z.string().min(1), pin: z.string().min(1).max(12) }),
  method: z.object({ methodId: z.uuid(), currencyCode: z.string().length(3) }),
  lines: z.array(z.object({ orderLineId: z.uuid(), qty: z.number().int().min(1), restock: z.boolean() })).min(1, "Choose what to refund").max(100),
});
export type RefundOrderInput = z.input<typeof refundOrderInput>;

export const cashMovementInput = z.object({
  branchId: z.uuid(),
  registerId: z.uuid(),
  type: z.enum(["pay_in", "pay_out"]),
  currencyCode: z.string().length(3),
  amount: money("Amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  reason: z.string().trim().min(1, "Give a reason").max(200),
});
export type CashMovementInput = z.input<typeof cashMovementInput>;

export const PAYMENT_METHOD_TYPES = ["cash", "khqr", "card", "bank_transfer", "account", "other"] as const;
export const paymentMethodInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  type: z.enum(PAYMENT_METHOD_TYPES),
  isActive: z.boolean().default(true),
});
export type PaymentMethodInput = z.input<typeof paymentMethodInput>;

export const branchPosSettingsInput = z.object({
  branchId: z.uuid(),
  varianceThreshold: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,6}(\.\d{1,2})?$/.test(v), "Threshold must be an amount like 1.00"),
  variancePinRequired: z.boolean(),
  allowNegativeStock: z.boolean(),
  kitchenEnabled: z.boolean().default(true),
});
export type BranchPosSettingsInput = z.input<typeof branchPosSettingsInput>;
