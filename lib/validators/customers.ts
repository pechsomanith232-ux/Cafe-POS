import { z } from "zod";

const money = (label: string) =>
  z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label} must be a number of 0 or more`);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const customerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: optText(30),
  /** null / empty = no credit account (can't charge to account). */
  creditLimit: z.union([money("Credit limit"), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  note: optText(300),
  isActive: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof customerInput>;

export const customerPaymentInput = z.object({
  customerId: z.uuid(),
  branchId: z.uuid(),
  /** Needed for cash: the money goes into that register's drawer. */
  registerId: z.uuid().optional().nullable(),
  methodId: z.uuid(),
  currencyCode: z.string().length(3),
  amount: money("Amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  reference: optText(80),
});
export type CustomerPaymentInput = z.input<typeof customerPaymentInput>;
