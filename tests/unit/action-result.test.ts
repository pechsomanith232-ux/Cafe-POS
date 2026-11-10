import { describe, expect, it, vi } from "vitest";
import { toActionResult } from "@/lib/action-result";
import { ConflictError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";

describe("toActionResult", () => {
  it("returns the value on success", async () => {
    expect(await toActionResult(async () => 42)).toEqual({ ok: true, data: 42 });
  });

  it("turns a validation error into a message plus field errors", async () => {
    const r = await toActionResult(async () => {
      throw new ValidationError("name: Name is required", { name: ["Name is required"] });
    });
    expect(r).toEqual({ ok: false, error: "name: Name is required", fieldErrors: { name: ["Name is required"] } });
  });

  it("passes through other user-facing errors", async () => {
    expect(await toActionResult(async () => { throw new ConflictError("Code B2 is used."); }))
      .toMatchObject({ ok: false, error: "Code B2 is used." });
    expect(await toActionResult(async () => { throw new ForbiddenError("Missing permission users.manage"); }))
      .toMatchObject({ ok: false, error: "Missing permission users.manage" });
  });

  it("hides unexpected errors behind a generic message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await toActionResult(async () => { throw new Error("connection string postgres://secret"); });
    expect(r).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    spy.mockRestore();
  });
});
