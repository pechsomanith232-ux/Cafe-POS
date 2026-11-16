import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/context", () => ({ getSessionUserId: async () => session.userId }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const KEY = "products/p1/a.png";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "uploads-route-"));
  await mkdir(join(dir, "products/p1"), { recursive: true });
  await writeFile(join(dir, KEY), PNG);
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const call = async () => {
  const { GET } = await import("@/app/api/uploads/[...key]/route");
  return GET(new Request("http://localhost/api/uploads/" + KEY), { params: Promise.resolve({ key: KEY.split("/") }) } as never);
};

describe("GET /api/uploads/[...key]", () => {
  it("returns 404 without a session and never reads storage", async () => {
    session.userId = null;
    const storage = (await import("@/lib/storage")).getStorage();
    const get = vi.spyOn(storage, "get");
    const res = await call();
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
  it("serves the stored file with a session", async () => {
    session.userId = "u1";
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});
