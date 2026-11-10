import { z } from "zod";
import { KITCHEN_STATIONS } from "@/db/schema/menu";

const decimalDp = (label: string, dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^-?\\d{1,12}(\\.\\d{1,${dp}})?$`).test(v), `${label} must be a number with at most ${dp} decimals`);
const price = (label: string) => decimalDp(label, 4).refine((v) => Number(v) >= 0, `${label} can't be negative`);
const optionalUuid = z.uuid().optional().nullable().or(z.literal("").transform(() => null));
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const distinctNames = <T extends { name: string }>(rows: T[]) => new Set(rows.map((r) => r.name.toLowerCase())).size === rows.length;

const recipeLine = z.object({
  itemId: z.uuid("Choose an item"),
  unitKey: z.string().min(1),
  qty: decimalDp("Quantity", 4).refine((v) => Number(v) !== 0, "Quantity can't be 0"),
});
const recipe = z.array(recipeLine).max(40).default([]);

export const menuCategoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #7c3aed").optional().nullable().or(z.literal("").transform(() => null)),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type MenuCategoryInput = z.input<typeof menuCategoryInput>;

export const productInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: optionalText(500),
  categoryId: optionalUuid,
  kitchenStation: z.enum(KITCHEN_STATIONS).default("bar"),
  deductStock: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  modifierGroupIds: z.array(z.uuid()).max(20).default([]).refine((ids) => new Set(ids).size === ids.length, "A modifier group is attached twice"),
  variants: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1, "Variant name is required").max(40),
        price: price("Price"),
        sku: optionalText(40),
        deductStock: z.boolean().nullable().default(null),
        isDefault: z.boolean().default(false),
        recipe: z.array(recipeLine.refine((l) => Number(l.qty) > 0, "Variant recipe quantities must be greater than 0")).max(40).default([]),
      }),
    )
    .min(1, "Add at least one variant (e.g. Regular)")
    .max(20)
    .refine(distinctNames, "Variant names must be different")
    .refine((v) => v.filter((x) => x.isDefault).length === 1, "Mark exactly one variant as the default"),
});
export type ProductInput = z.input<typeof productInput>;

export const modifierGroupInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(60),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1, "Max must be at least 1").max(20),
    isActive: z.boolean().default(true),
    modifiers: z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: z.string().trim().min(1, "Option name is required").max(60),
          priceDelta: decimalDp("Price change", 4),
          deductStock: z.boolean().default(true),
          recipe,
        }),
      )
      .max(40)
      .default([])
      .refine(distinctNames, "Option names must be different"),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "Min can't be more than max", path: ["minSelect"] })
  .superRefine((g, c) => {
    if (g.modifiers.length < g.minSelect) c.addIssue({ code: "custom", path: ["modifiers"], message: `A group with a minimum of ${g.minSelect} needs at least ${g.minSelect} options` });
  });
export type ModifierGroupInput = z.input<typeof modifierGroupInput>;

export const branchPriceInput = z.object({
  branchId: z.uuid(),
  variantId: z.uuid(),
  price: price("Price").nullable(),
  isAvailable: z.boolean(),
});
