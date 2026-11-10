import { z } from "zod";

const decimalDp = (label: string, dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^-?\\d{1,12}(\\.\\d{1,${dp}})?$`).test(v), `${label} must be a number with at most ${dp} decimals`);
/** Quantities: up to 4 decimals (numeric(18,4)). */
const decimal = (label: string) => decimalDp(label, 4);
/** Costs: up to 6 decimals. */
const costDecimal = (label: string) => decimalDp(label, 6);
const positive = (label: string) => decimal(label).refine((v) => Number(v) > 0, `${label} must be greater than 0`);
const nonNegative = (label: string) => decimal(label).refine((v) => Number(v) >= 0, `${label} can't be negative`);
const nonNegativeCost = (label: string) => costDecimal(label).refine((v) => Number(v) >= 0, `${label} can't be negative`);
const optionalUuid = z.uuid().optional().nullable().or(z.literal("").transform(() => null));

export const ITEM_TYPES = ["ingredient", "resale", "packaging", "other"] as const;
export const BASE_UNIT_CODES = ["ml", "L", "g", "kg", "pcs"] as const;
export const ADJUSTMENT_REASONS = ["waste", "damage", "expired", "staff_meal", "correction", "other"] as const;

export const categoryInput = z.object({ name: z.string().trim().min(1, "Name is required").max(60) });

export const itemInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  sku: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v : null)),
  categoryId: optionalUuid,
  baseUnitCode: z.enum(BASE_UNIT_CODES),
  itemType: z.enum(ITEM_TYPES).default("ingredient"),
  units: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1, "Unit name is required").max(30),
        factor: costDecimal("Factor").refine((v) => Number(v) > 0, "Factor must be greater than 0"),
        isPurchaseDefault: z.boolean().default(false),
        isCountDefault: z.boolean().default(false),
      }),
    )
    .max(10)
    .default([])
    .refine((u) => new Set(u.map((x) => x.name.toLowerCase())).size === u.length, "Unit names must be different")
    .refine((u) => u.filter((x) => x.isPurchaseDefault).length <= 1, "Only one unit can be the purchase default")
    .refine((u) => u.filter((x) => x.isCountDefault).length <= 1, "Only one unit can be the count default"),
});
export type ItemInput = z.input<typeof itemInput>;

export const reorderInput = z.object({
  branchId: z.uuid(),
  itemId: z.uuid(),
  unitKey: z.string().min(1),
  qty: nonNegative("Reorder level").nullable(),
});

export const openingInput = z.object({
  branchId: z.uuid(),
  itemId: z.uuid(),
  unitKey: z.string().min(1),
  qty: positive("Quantity"),
  /** Cost per ENTERED unit (e.g. per case). */
  unitCost: nonNegativeCost("Unit cost"),
});

export const adjustmentInput = z
  .object({
    branchId: z.uuid(),
    reasonCode: z.enum(ADJUSTMENT_REASONS),
    note: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
    lines: z
      .array(
        z.object({
          itemId: z.uuid(),
          unitKey: z.string().min(1),
          qty: decimal("Quantity").refine((v) => Number(v) !== 0, "Quantity can't be zero"),
          /** Optional cost per ENTERED unit, for additions only. */
          unitCost: nonNegativeCost("Unit cost").optional().nullable(),
        }),
      )
      .min(1, "Add at least one item"),
  })
  .refine((a) => a.reasonCode !== "other" || !!a.note, { message: "Please explain the reason in the note", path: ["note"] });
export type AdjustmentInput = z.input<typeof adjustmentInput>;

export const countCreateInput = z.object({
  branchId: z.uuid(),
  categoryId: optionalUuid,
  note: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
});

export const countLinesInput = z.array(
  z.object({
    itemId: z.uuid(),
    unitKey: z.string().min(1),
    /** null = clear the entry */
    qty: nonNegative("Counted quantity").nullable(),
  }),
);

/** A stock transfer: whole quantities sent from one branch to another. */
export const transferInput = z.object({
  fromBranchId: z.uuid(),
  toBranchId: z.uuid(),
  note: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
  lines: z
    .array(z.object({ itemId: z.uuid(), unitKey: z.string().min(1), qty: decimal("Quantity").refine((v) => Number(v) > 0, "Quantity must be more than zero") }))
    .min(1, "Add at least one item"),
}).refine((t) => t.fromBranchId !== t.toBranchId, "Choose a different branch to send to.");
export type TransferInput = z.input<typeof transferInput>;

export const receiveTransferInput = z.object({
  lines: z.array(z.object({ lineId: z.uuid(), qtyReceived: decimal("Received quantity").refine((v) => Number(v) >= 0, "Received can't be negative") })),
});
export type ReceiveTransferInput = z.input<typeof receiveTransferInput>;
