import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isSafeKey, localDriver, s3Driver, sniffImage, storageFromEnv } from "@/lib/storage";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const dirs: string[] = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

describe("sniffImage", () => {
  it("detects JPEG, PNG and WebP by their bytes, not the file name", () => {
    expect(sniffImage(PNG)).toEqual({ contentType: "image/png", ext: "png" });
    expect(sniffImage(JPG)).toEqual({ contentType: "image/jpeg", ext: "jpg" });
    expect(sniffImage(WEBP)).toEqual({ contentType: "image/webp", ext: "webp" });
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("isSafeKey", () => {
  it("accepts generated keys and rejects path tricks", () => {
    expect(isSafeKey("products/0b9e6a1c-1111-4222-8333-444455556666/ab12cd34.png")).toBe(true);
    expect(isSafeKey("../etc/passwd")).toBe(false);
    expect(isSafeKey("products/../../x.png")).toBe(false);
    expect(isSafeKey("/abs/x.png")).toBe(false);
    expect(isSafeKey("products/x.svg")).toBe(false);
  });
});

describe("localDriver", () => {
  it("stores, reads, serves under /api/uploads and deletes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uploads-")); dirs.push(dir);
    const s = localDriver(dir);
    await s.put("products/p1/a.png", PNG, "image/png");
    expect(new Uint8Array(await readFile(join(dir, "products/p1/a.png")))).toEqual(PNG);
    expect(await s.url("products/p1/a.png")).toBe("/api/uploads/products/p1/a.png");
    expect(await s.get("products/p1/a.png")).toEqual({ body: PNG, contentType: "image/png" });
    await s.delete("products/p1/a.png");
    expect(await s.get("products/p1/a.png")).toBeNull();
    await expect(s.put("../x.png", PNG, "image/png")).rejects.toThrow(/key/);
  });
});

describe("s3Driver", () => {
  it("puts and deletes objects, and uses the public URL when set", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const client = { send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => { sent.push({ name: cmd.constructor.name, input: cmd.input }); return {}; } };
    const s = s3Driver({ client: client as never, bucket: "menu", publicBaseUrl: "https://img.example.com/" });
    await s.put("products/p1/a.png", PNG, "image/png");
    await s.delete("products/p1/a.png");
    expect(sent.map((c) => [c.name, c.input.Bucket, c.input.Key])).toEqual([["PutObjectCommand", "menu", "products/p1/a.png"], ["DeleteObjectCommand", "menu", "products/p1/a.png"]]);
    expect(sent[0].input.ContentType).toBe("image/png");
    expect(await s.url("products/p1/a.png")).toBe("https://img.example.com/products/p1/a.png");
  });
});

describe("storageFromEnv", () => {
  it("defaults to the local uploads folder and requires bucket settings for s3", () => {
    expect(storageFromEnv({}).kind).toBe("local");
    expect(() => storageFromEnv({ STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(storageFromEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ENDPOINT: "https://x.r2.cloudflarestorage.com", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }).kind).toBe("s3");
  });
});
