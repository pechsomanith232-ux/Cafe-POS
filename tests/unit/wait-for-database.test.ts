import { describe, expect, it } from "vitest";
import { waitForDatabase } from "@/db/wait-for-database";

describe("waitForDatabase", () => {
  it("keeps trying until the database accepts connections", async () => {
    let calls = 0;
    await waitForDatabase(
      async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNRESET");
      },
      { attempts: 5, delayMs: 1 },
    );
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt and reports the last error", async () => {
    let calls = 0;
    await expect(
      waitForDatabase(
        async () => {
          calls++;
          throw new Error(`connection refused #${calls}`);
        },
        { attempts: 4, delayMs: 1 },
      ),
    ).rejects.toThrow(/after 4 attempts.*connection refused #4/);
    expect(calls).toBe(4);
  });
});
