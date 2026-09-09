import { readFileSync } from "node:fs";
import { gunzipSync } from "bun";

/**
 * Real pages captured from Tabelog, gzipped because the raw HTML is ~100 KB
 * each. They exist so a markup change shows up as a failing assertion instead
 * of a field quietly turning undefined. When Tabelog redesigns, re-capture from
 * the same URLs (listed beside each fixture in the tests); a fixture that no
 * longer matches the live site is worse than none.
 */

const cache = new Map<string, string>();

export const fixture = (name: string): string => {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const path = new URL(`./fixture/${name}.gz`, import.meta.url).pathname;
  const text = new TextDecoder().decode(gunzipSync(readFileSync(path)));
  cache.set(name, text);
  return text;
};
