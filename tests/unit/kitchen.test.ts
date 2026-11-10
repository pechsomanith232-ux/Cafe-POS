import { describe, expect, it } from "vitest";
import { elapsedTone } from "@/lib/pos/kitchen";

describe("elapsedTone", () => {
  it("is green under 5 minutes, amber under 10, red from 10", () => {
    expect([0, 4 * 60_000 + 59_000, 5 * 60_000, 9 * 60_000 + 59_000, 10 * 60_000, 30 * 60_000].map(elapsedTone)).toEqual(["green", "green", "amber", "amber", "red", "red"]);
  });
});
