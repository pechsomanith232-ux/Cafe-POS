import { describe, expect, it } from "vitest";
import { checkHealth } from "@/lib/health";

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    const result = await checkHealth(async () => {});
    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("ok");
    expect(result.body.db).toBe("ok");
  });

  it("reports 503 when the database query fails, without leaking the error", async () => {
    const result = await checkHealth(async () => {
      throw new Error("password authentication failed for user postgres");
    });
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("error");
    expect(result.body.db).toBe("down");
    expect(JSON.stringify(result.body)).not.toContain("password");
  });

  it("reports 503 when the database does not answer in time", async () => {
    const result = await checkHealth(() => new Promise(() => {}), { timeoutMs: 50 });
    expect(result.httpStatus).toBe(503);
    expect(result.body.db).toBe("timeout");
  });
});
