import { z } from "zod";

/** "Sell on POS" settings for an inventory item (its item-managed product). */
export const itemSaleInput = z.object({
  enabled: z.boolean(),
  price: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), "Price must be a number of 0 or more with at most 4 decimals"),
  categoryId: z.uuid().nullable().or(z.literal("").transform(() => null)),
  /** base | g:<code> | iu:<itemUnitId> (lib/domain/units.ts) */
  unitKey: z.string().min(1),
});
export type ItemSaleInput = z.input<typeof itemSaleInput>;
