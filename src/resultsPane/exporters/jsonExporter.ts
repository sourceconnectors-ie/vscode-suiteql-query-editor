export function toJson(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(rows, null, 2);
}
