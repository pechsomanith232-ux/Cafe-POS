import { unstable_rethrow } from "next/navigation";
import { AppError, ApprovalRequiredError, ValidationError } from "./errors";
import { ForbiddenError } from "./permissions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: "approval_required"; permission?: string };

/**
 * Run a Server Action body and convert known errors into a result the form
 * can show. Unexpected errors are logged and replaced by a generic message so
 * no internals reach the browser. Next.js redirects/not-found pass through.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApprovalRequiredError) {
      return { ok: false, error: err.message, code: err.code, permission: err.permission };
    }
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    }
    if (err instanceof AppError || err instanceof ForbiddenError) {
      return { ok: false, error: err.message };
    }
    console.error("Server action failed:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
