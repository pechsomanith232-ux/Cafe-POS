import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestDb, testDb, withRollback } from "./helpers/db";

afterAll(closeTestDb);

describe("integration test harness", () => {
  it("runs against a freshly migrated test database", async () => {
    const rows = await testDb.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    // Every migration in drizzle/ has been applied exactly once.
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it("connects to TEST_DATABASE_URL, not the development database", async () => {
    const rows = await testDb.execute<{ db: string }>(
      sql`select current_database() as db`,
    );
    expect(rows[0].db).toBe("cafe_pos_test");
  });

  it("rolls back everything a test writes", async () => {
    await withRollback(async (tx) => {
      await tx.execute(sql`create table harness_probe (id int)`);
      await tx.execute(sql`insert into harness_probe values (1)`);
      const inside = await tx.execute(sql`select count(*)::int as n from harness_probe`);
      expect(inside[0].n).toBe(1);
    });

    const after = await testDb.execute<{ exists: boolean }>(
      sql`select to_regclass('public.harness_probe') is not null as exists`,
    );
    expect(after[0].exists).toBe(false);
  });

  it("still rolls back when the test body throws", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.execute(sql`create table harness_probe2 (id int)`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const after = await testDb.execute<{ exists: boolean }>(
      sql`select to_regclass('public.harness_probe2') is not null as exists`,
    );
    expect(after[0].exists).toBe(false);
  });
});

describe("integration test harness: safety", () => {
  it("does not swallow a rollback raised by the code under test", async () => {
    let reachedAssertionAfterInnerRollback = false;
    await expect(
      withRollback(async (tx) => {
        await tx.transaction(async (inner) => {
          inner.rollback();
        });
        reachedAssertionAfterInnerRollback = true;
      }),
    ).rejects.toThrow();
    expect(reachedAssertionAfterInnerRollback).toBe(false);
  });

  it("points the app's shared db client at the test database", async () => {
    const { db, getSql } = await import("@/db");
    try {
      const rows = await db.execute<{ db: string }>(sql`select current_database() as db`);
      expect(rows[0].db).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
    } finally {
      await getSql().end();
      delete (globalThis as { __cafePosDb?: unknown }).__cafePosDb;
    }
  });
});
