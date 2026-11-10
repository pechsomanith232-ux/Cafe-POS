import { getSql } from "@/db";
import { checkHealth } from "@/lib/health";

// GET /api/health — used by the Docker HEALTHCHECK, Coolify and uptime checks.
export async function GET(request: Request): Promise<Response> {
  // Touching the request makes Next.js run this on every request instead of
  // prerendering it at build time (Cache Components). `connection()` would do
  // the same but cannot be called outside a live request, e.g. in tests.
  void request.headers;

  const { httpStatus, body } = await checkHealth(async () => {
    await getSql()`select 1`;
  });

  return Response.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
