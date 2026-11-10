export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

const NUMBER = /^-?\d+(\.\d+)?$/;

function cell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw);
  // Stop spreadsheet apps treating text as a formula (CSV injection),
  // but leave plain negative numbers alone.
  if (/^[=+@\t\r]/.test(s) || (s.startsWith("-") && !NUMBER.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a UTF-8 BOM (so Excel shows Khmer text and ៛ correctly) and CRLF line endings. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
