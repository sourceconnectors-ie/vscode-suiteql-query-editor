import { COMPANY_URL } from "@monty-nabil/netsuite-api-client-ts";

/**
 * The company URL tagged for web analytics. A link opened from the editor sends no
 * Referer, so without a tag these visits look like direct traffic. The tag names this
 * extension (the library tags its own links differently), so the two can be told apart.
 * What the UI *shows* stays the plain COMPANY_URL; only the link that gets opened is tagged.
 */
export function attributionUrl(): string {
  const url = new URL(COMPANY_URL);
  url.searchParams.set("utm_source", "suiteql-query-editor");
  url.searchParams.set("utm_medium", "vscode-extension");
  url.searchParams.set("utm_campaign", "attribution");
  return url.toString();
}
