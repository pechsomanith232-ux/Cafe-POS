import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const branchInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(10)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Name is required").max(100),
  address: optionalText,
  phone: optionalText,
  receiptHeader: optionalText,
  receiptFooter: optionalText,
  taxRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? "0" : String(v)))
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "Tax rate must be 0–100"),
  taxInclusive: z.boolean().optional().default(true),
});
export type BranchInput = z.input<typeof branchInput>;

export const password = z.string().min(8, "Password must be at least 8 characters").max(128);
export const pin = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

export const createUserInput = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  name: z.string().trim().min(1, "Name is required").max(100),
  password,
  branchId: z.uuid(),
  roleId: z.uuid(),
  pin: pin.optional(),
});
export type CreateUserInput = z.input<typeof createUserInput>;

export const branchRoleInput = z.object({
  userId: z.string().min(1),
  branchId: z.uuid(),
  roleId: z.uuid(),
});

export const roleInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  permissions: z.array(
    z.object({
      key: z.string(),
      limit: z
        .union([z.string(), z.number()])
        .optional()
        .nullable()
        .transform((v) => (v === undefined || v === null || v === "" ? null : String(v)))
        .refine((v) => v === null || (/^\d+(\.\d+)?$/.test(v) && Number(v) <= 1_000_000), "Limit must be a number ≥ 0"),
    }),
  ),
});
export type RoleInput = z.input<typeof roleInput>;
