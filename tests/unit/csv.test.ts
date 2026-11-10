import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header and rows, quoting commas, quotes and newlines", () => {
    const csv = toCsv([{ name: 'Milk, "fresh"', qty: "12" }, { name: "Line\nbreak", qty: "-800" }], [
      { header: "Name", value: (r) => r.name },
      { header: "Qty", value: (r) => r.qty },
    ]);
    expect(csv).toBe('﻿Name,Qty\r\n"Milk, ""fresh""",12\r\n"Line\nbreak",-800\r\n');
  });

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    const csv = toCsv([{ v: "=HYPERLINK(1)" }, { v: "+1+1" }, { v: "@cmd" }, { v: "-12.5" }, { v: "-x" }], [{ header: "V", value: (r) => r.v }]);
    expect(csv.split("\r\n").slice(1, 6)).toEqual(["'=HYPERLINK(1)", "'+1+1", "'@cmd", "-12.5", "'-x"]);
  });

  it("writes empty cells for null and undefined", () => {
    expect(toCsv([{ a: null }], [{ header: "A", value: (r) => r.a }])).toBe("﻿A\r\n\r\n");
  });
});
