import { describe, expect, it } from "vitest";
import { assertResetAllowed } from "@/db/reset-guard";

const LOCAL_URL = "postgres://postgres:postgres@localhost:5432/cafe_pos";

describe("assertResetAllowed", () => {
  it("allows a reset of a local database outside production", () => {
    expect(() =>
      assertResetAllowed({ NODE_ENV: "development", DATABASE_URL: LOCAL_URL }),
    ).not.toThrow();
  });

  it("refuses when NODE_ENV is production", () => {
    expect(() =>
      assertResetAllowed({ NODE_ENV: "production", DATABASE_URL: LOCAL_URL }),
    ).toThrow(/production/);
  });

  it("refuses when DATABASE_URL is missing", () => {
    expect(() => assertResetAllowed({ NODE_ENV: "development" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("refuses a database that is not on this machine", () => {
    expect(() =>
      assertResetAllowed({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://app:secret@10.0.0.5:5432/cafe_pos",
      }),
    ).toThrow(/local/);
  });
});
