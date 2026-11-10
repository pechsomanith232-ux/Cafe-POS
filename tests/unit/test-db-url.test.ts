import { describe, expect, it } from "vitest";
import { getTestDatabaseUrl } from "../integration/test-db-url";

describe("getTestDatabaseUrl", () => {
  it("returns a URL whose database name contains 'test'", () => {
    const url = "postgres://u:p@localhost:5432/cafe_pos_test";
    expect(getTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it("refuses the development database, because tests wipe it", () => {
    expect(() =>
      getTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost:5432/cafe_pos" }),
    ).toThrow(/must contain "test"/);
  });

  it("refuses when TEST_DATABASE_URL is missing", () => {
    expect(() => getTestDatabaseUrl({})).toThrow(/TEST_DATABASE_URL/);
  });
});
