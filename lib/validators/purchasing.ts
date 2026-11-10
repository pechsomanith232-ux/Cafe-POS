import { z } from "zod";

const num = (label: string, dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d{1,12}(\\.\\d{1,${dp}})?$`).test(v), `${label} must be a number ≥ 0 with at most ${dp} decimals`);
const positive = (label: string, dp: number) => num(label, dp).refine((v) => Number(v) > 0, `${label} must be greater than 0`);
const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-08").refine((v) => !isNaN(Date.parse(v)), "Invalid date");

export const supplierInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  contactName: text(100),
  phone: text(40),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().nullable().transform((v) => (v ? v : null)),
  address: text(300),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  note: text(500),
});
export type SupplierInput = z.input<typeof supplierInput>;

export const receiptInput = z
  .object({
    branchId: z.uuid(),
    purchaseType: z.enum(["credit", "direct"]),
    supplierId: z.uuid().optional().nullable().or(z.literal("").transform(() => null)),
    supplierNameText: text(100),
    supplierInvoiceNo: text(60),
    receiptDate: isoDate,
    paymentTermsDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
    note: text(500),
    lines: z
      .array(z.object({ itemId: z.uuid(), unitKey: z.string().min(1), qty: positive("Quantity", 4), unitCost: num("Unit cost", 6) }))
      .min(1, "Add at least one item")
      .max(200),
    extraCosts: z.array(z.object({ description: z.string().trim().min(1, "Describe the extra cost").max(100), amount: positive("Extra cost", 4) })).max(20).default([]),
  })
  .refine((r) => r.purchaseType === "direct" || !!r.supplierId, { message: "Choose a supplier for a credit purchase", path: ["supplierId"] });
export type ReceiptInput = z.input<typeof receiptInput>;

export const paymentDetailsInput = z.object({
  methodId: z.uuid(),
  currencyCode: z.string().min(3).max(3),
  /** Currency units per 1 USD; required for non-USD. */
  rate: positive("Exchange rate", 6).optional().nullable(),
  reference: text(100),
  /** Direct purchase paid with cash from a register's drawer: writes a pay-out on its open shift. */
  paidFromDrawer: z.object({ registerId: z.uuid() }).optional().nullable(),
});
export type PaymentDetails = z.input<typeof paymentDetailsInput>;

export const allocationsInput = z.array(z.object({ receiptId: z.uuid(), amount: positive("Allocation", 4) })).max(200);

export const supplierPaymentInput = paymentDetailsInput.extend({
  branchId: z.uuid(),
  supplierId: z.uuid(),
  paymentDate: isoDate,
  amount: positive("Amount", 4),
  note: text(500),
  /** Omit for automatic oldest-first allocation. */
  allocations: allocationsInput.optional(),
});
export type SupplierPaymentInput = z.input<typeof supplierPaymentInput>;

export const supplierReturnInput = z.object({
  receiptId: z.uuid(),
  returnDate: isoDate,
  reason: z.string().trim().min(1, "Give a reason").max(300),
  lines: z.array(z.object({ receiptLineId: z.uuid(), qty: positive("Quantity", 4) })).min(1, "Choose what to return"),
  /** Direct receipts only: how the refund was received. */
  refund: paymentDetailsInput.optional().nullable(),
});
export type SupplierReturnInput = z.input<typeof supplierReturnInput>;
