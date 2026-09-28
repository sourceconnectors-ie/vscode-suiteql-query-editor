/** Leading characters that make Excel/Sheets treat a cell as a formula. */
const FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r\n]/;
/** A plain number (e.g. "-12.5", "+3", "1e-5") — starts with a trigger character but is data, not a formula. */
const PLAIN_NUMBER_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Guards against CSV/formula injection: a NetSuite field value like `=HYPERLINK(...)`
 * would otherwise run as a formula when the export is opened in a spreadsheet. Such cells
 * get a leading `'`, which spreadsheets treat as "this is text". Plain numbers such as
 * negative amounts are left untouched so they stay numeric.
 */
function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER_REGEX.test(text) && !PLAIN_NUMBER_REGEX.test(text) ? `'${text}` : text;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = neutralizeFormula(typeof value === "string" ? value : JSON.stringify(value));
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
