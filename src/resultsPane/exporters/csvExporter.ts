function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    // Object.hasOwn: NetSuite omits null-valued columns from a row entirely, so a missing
    // key is routine — and a plain `row[column]` for a missing "constructor"/"__proto__"
    // column would read Object.prototype's member instead of blank.
    lines.push(columns.map((column) => escapeCsvCell(Object.hasOwn(row, column) ? row[column] : undefined)).join(","));
  }
  return lines.join("\r\n");
}
