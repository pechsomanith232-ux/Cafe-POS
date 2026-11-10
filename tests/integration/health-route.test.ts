import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The route uses the app's shared db client; setup-env.ts points it at the
// test database.
let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET } = await import("@/app/api/health/route"));
});

afterAll(async () => {
  const { getSql } = await import("@/db");
  await getSql().end();
});

describe("GET /api/health", () => {
  it("returns 200 with db ok when PostgreSQL is reachable", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: "ok" });
  });
});
