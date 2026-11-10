import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Executor } from "@/db/client";
import { account, profiles, user } from "@/db/schema";

/**
 * Insert a Better Auth user with an email + password login, plus its profile.
 * Rows match what Better Auth's own sign-up writes (provider "credential"),
 * but go through the caller's transaction so they commit or roll back with it.
 * No permission check here: callers (seed, users service) do that.
 */
export async function insertAuthUser(
  tx: Executor,
  input: { orgId: string; email: string; name: string; password: string },
): Promise<string> {
  const userId = randomUUID();
  const email = input.email.trim().toLowerCase();
  await tx.insert(user).values({ id: userId, email, name: input.name, emailVerified: true });
  await tx.insert(account).values({
    id: randomUUID(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: await hashPassword(input.password),
  });
  await tx.insert(profiles).values({ userId, orgId: input.orgId, fullName: input.name });
  return userId;
}
