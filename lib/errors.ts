import type { z } from "zod";

/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed validation. `fieldErrors` maps field names to messages for forms. */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

/** Something with the same unique value already exists. */
export class ConflictError extends AppError {}

/** The record doesn't exist (or isn't visible to this user). */
export class NotFoundError extends AppError {}

/** Manager PIN rejected or locked out. */
export class PinError extends AppError {}

/** Parse `input` with a Zod schema, throwing ValidationError on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = result.error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  throw new ValidationError(`${where}${first?.message ?? "Invalid input"}`, fieldErrors);
}

/** The action needs a manager's PIN for `permission` (the POS opens the PIN dialog). */
export class ApprovalRequiredError extends AppError {
  readonly code = "approval_required";
  constructor(message: string, readonly permission: string) {
    super(message);
  }
}
