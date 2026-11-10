import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, organizations } from "@/db/schema";
import { closeTestDb, dbErrorMessage, withRollback } from "./helpers/db";

afterAll(closeTestDb);

describe("audit_log is append-only (plan §2.3, §5.7)", () => {
  async function insertEntry(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
    const [org] = await tx.insert(organizations).values({ name: "Org" }).returning();
    const [row] = await tx
      .insert(auditLog)
      .values({ orgId: org.id, action: "test", entity: "thing" })
      .returning();
    return row;
  }

  it("allows inserting", async () => {
    await withRollback(async (tx) => {
      const row = await insertEntry(tx);
      expect(row.id).toBeTruthy();
    });
  });

  it("rejects UPDATE", async () => {
    await withRollback(async (tx) => {
      const row = await insertEntry(tx);
      expect(
        await dbErrorMessage(
          tx.update(auditLog).set({ action: "changed" }).where(eq(auditLog.id, row.id)),
        ),
      ).toMatch(/append-only/);
    });
  });

  it("rejects DELETE", async () => {
    await withRollback(async (tx) => {
      const row = await insertEntry(tx);
      expect(await dbErrorMessage(tx.delete(auditLog).where(eq(auditLog.id, row.id)))).toMatch(
        /append-only/,
      );
    });
  });

  it("rejects TRUNCATE", async () => {
    await withRollback(async (tx) => {
      await insertEntry(tx);
      expect(await dbErrorMessage(tx.execute(sql`truncate audit_log`))).toMatch(/append-only/);
    });
  });
});
