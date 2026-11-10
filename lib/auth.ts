import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Better Auth (plan §1, §5.1): email + password, database sessions.
 * There is no public sign-up — admins create users from Settings → Users.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Profile changes go through our audited services (Settings → Users), not
  // Better Auth's self-service endpoint, so names can't change unaudited.
  disabledPaths: ["/update-user"],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once a day while in use
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated users can't sign in.
        before: async (session) => {
          const [profile] = await db
            .select({ isActive: schema.profiles.isActive })
            .from(schema.profiles)
            .where(eq(schema.profiles.userId, session.userId));
          if (!profile?.isActive) return false;
          return { data: session };
        },
      },
    },
  },
  // Must be last: lets Server Actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
