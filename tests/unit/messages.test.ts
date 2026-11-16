import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import km from "@/messages/km.json";

function flatten(obj: Record<string, unknown>, prefix = ""): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v] as [string, unknown]],
  );
}

describe("messages", () => {
  it("km.json has exactly the same keys as en.json", () => {
    const enKeys = flatten(en).map(([k]) => k);
    const kmKeys = flatten(km).map(([k]) => k);
    expect(kmKeys.sort()).toEqual(enKeys.sort());
  });

  it("no message is empty", () => {
    for (const [key, value] of [...flatten(en), ...flatten(km)]) {
      expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
    }
  });
});
