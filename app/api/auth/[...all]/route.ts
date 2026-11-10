import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth endpoints: sign-in, sign-out, session, change-password (plan §3).
export const { GET, POST } = toNextJsHandler(auth);
