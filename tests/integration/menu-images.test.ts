import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getProduct } from "@/lib/queries/menu";
import { saveProduct } from "@/lib/services/menu";
import { removeProductImage, uploadProductImage } from "@/lib/services/menu-images";
import { localDriver } from "@/lib/storage";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const dirs: string[] = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); await closeTestDb(); });

async function files(dir: string) {
  try { return await readdir(dir, { recursive: true }).then((f) => f.map((x) => String(x).replaceAll("\\", "/")).filter((x) => /\.(png|jpg|webp)$/.test(String(x)))); } catch { return []; }
}

describe("product images", () => {
  it("uploads, replaces (old file removed) and removes an image", async () => {
    await withRollback(async (tx) => {
      const dir = await mkdtemp(join(tmpdir(), "img-")); dirs.push(dir);
      const storage = localDriver(dir);
      const w = await createWorld(tx);
      const owner = await w.ctxFor(w.users.owner);
      const p = await saveProduct(owner, null, { name: "Croissant", kitchenStation: "kitchen", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "2", deductStock: null, isDefault: true, recipe: [] }] });

      const first = await uploadProductImage(owner, p.id, PNG, storage);
      expect(first.key).toMatch(new RegExp(`^products/${p.id}/[a-f0-9]{32}\\.png$`));
      expect((await getProduct(owner, p.id)).imageKey).toBe(first.key);
      const second = await uploadProductImage(owner, p.id, JPG, storage);
      expect(second.key).toMatch(/\.jpg$/);
      expect(await files(dir)).toEqual([second.key]);

      await removeProductImage(owner, p.id, storage);
      expect((await getProduct(owner, p.id)).imageKey).toBeNull();
      expect(await files(dir)).toEqual([]);
    });
  });

  it("refuses non-images, big files, missing products and users without menu.manage — leaving no file behind", async () => {
    await withRollback(async (tx) => {
      const dir = await mkdtemp(join(tmpdir(), "img-")); dirs.push(dir);
      const storage = localDriver(dir);
      const w = await createWorld(tx);
      const owner = await w.ctxFor(w.users.owner);
      const p = await saveProduct(owner, null, { name: "Bagel", kitchenStation: "kitchen", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "2", deductStock: null, isDefault: true, recipe: [] }] });
      await expect(uploadProductImage(owner, p.id, new TextEncoder().encode("<svg/>"), storage)).rejects.toThrow(ValidationError);
      const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(PNG);
      await expect(uploadProductImage(owner, p.id, big, storage)).rejects.toThrow(/2 MB/);
      await expect(uploadProductImage(owner, "00000000-0000-4000-8000-000000000000", PNG, storage)).rejects.toThrow(/not found/i);
      await expect(uploadProductImage(await w.ctxFor(w.users.cashier), p.id, PNG, storage)).rejects.toThrow(ForbiddenError);
      expect(await files(dir)).toEqual([]);
    });
  });
});
