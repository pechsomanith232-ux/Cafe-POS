import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { auth } from "./auth";
import { buildContext, NoBranchAccessError, UnauthorizedError } from "./context-builder";
import type { AppContext } from "./permissions";

/** Cookie holding the active branch id (branch switcher). Validated on every request. */
export const BRANCH_COOKIE = "pos_branch";

/** The signed-in user's id, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

/**
 * Request context: user, active branch, branches and permissions (plan §5.9).
 * Cached per request. Redirects to /login when signed out or deactivated.
 */
export const getContext = cache(async (): Promise<AppContext> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/login");

  const requestedBranchId = (await cookies()).get(BRANCH_COOKIE)?.value ?? null;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

  try {
    return await buildContext(db, { userId: session.user.id, requestedBranchId, ip });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/login");
    if (err instanceof NoBranchAccessError) redirect("/no-access");
    throw err;
  }
});
