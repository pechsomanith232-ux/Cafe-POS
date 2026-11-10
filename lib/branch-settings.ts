import { z } from "zod";

// Typed view of branches.settings (jsonb). Missing keys take the §12 defaults
// the owner confirmed on 2026-11-09.
export const branchSettingsSchema = z.object({
  /** Shift cash difference (in USD) above which closing needs a manager's PIN. */
  varianceThreshold: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).default("1.00"),
  /** Owner's switch: require the manager PIN for a variance above the threshold. */
  variancePinRequired: z.boolean().default(true),
  /** Selling more than is in stock is allowed (with a warning); off = refuse. */
  allowNegativeStock: z.boolean().default(true),
  /** Owner's switch: use the kitchen screen. Off = nothing is sent to the kitchen. */
  kitchenEnabled: z.boolean().default(true),
});
export type BranchSettings = z.infer<typeof branchSettingsSchema>;

export function readBranchSettings(raw: unknown): BranchSettings {
  const parsed = branchSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : branchSettingsSchema.parse({});
}
