/**
 * Just enough HTML handling to read Tabelog's server-rendered markup without a
 * parser dependency. Every selector we rely on is a stable BEM class name that
 * the site has carried for years (list-rst__*, rvw-item__*, rstinfo-table).
 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export const decodeEntity = (text: string): string => {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITY_MAP[body.toLowerCase()] ?? whole;
  });
};

/** Drop tags, decode entities and collapse whitespace into single spaces. */
export const textOf = (html: string): string => {
  return decodeEntity(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{2,}/g, "\n"),
  ).trim();
};

/** First capture group of the pattern, as clean text, or undefined. */
export const pick = (html: string, pattern: RegExp): string | undefined => {
  const match = pattern.exec(html);
  const captured = match?.[1];
  if (captured === undefined) return undefined;
  const text = textOf(captured);
  return text.length ? text : undefined;
};

/** Every first capture group of a global pattern, as clean text, empties dropped. */
export const pickAll = (html: string, pattern: RegExp): string[] => {
  const list: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const text = textOf(captured);
    if (text.length) list.push(text);
  }
  return list;
};

/**
 * Split a page into the chunks that start with a marker, dropping whatever
 * precedes the first one. Used for repeating cards (search results, reviews).
 */
export const splitBy = (html: string, marker: string): string[] => {
  const list = html.split(marker);
  list.shift();
  return list.map((chunk) => marker + chunk);
};

/**
 * Inner text of the first element carrying exactly this class. The class has to
 * be a whole token in the attribute: `\b` would not do, because a hyphen is a
 * word boundary and `list-rst__price` would then match `list-rst__price-tax`
 * and read the wrong value.
 */
export const classText = (html: string, className: string): string | undefined => {
  const pattern = new RegExp(`class="(?:[^"]*\\s)?${className}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</`);
  return pick(html, pattern);
};

export const attrOf = (html: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(html);
  const value = match?.[1];
  return value === undefined || value.length === 0 ? undefined : decodeEntity(value);
};

export const toNumber = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const cleaned = text.replace(/,/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

/** Parse every <script type="application/ld+json"> block that parses as JSON. */
export const jsonLdList = (html: string): Record<string, unknown>[] => {
  const list: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1] ?? "") as unknown;
      if (parsed && typeof parsed === "object") list.push(parsed as Record<string, unknown>);
    } catch {
      // Not our concern: a malformed block is skipped rather than failing the page.
    }
  }
  return list;
};

/**
 * Tabelog's pager (`c-pagination`): the current page is a `<strong ...
 * is-current>` and the last page is the largest number shown. Asking for a page
 * past the end silently serves page 1 again, so callers compare `current`
 * with what they asked for instead of trusting the URL.
 */
export const parsePagination = (html: string): { current: number | undefined; last: number | undefined } => {
  const current = toNumber(pick(html, /c-pagination__num[^"]*is-current[^>]*>\s*([\d,]+)\s*</));
  const numberList = pickAll(html, /c-pagination__num[^>]*>\s*([\d,]+)\s*</g)
    .map((text) => toNumber(text))
    .filter((value): value is number => value !== undefined);
  return { current, last: numberList.length ? Math.max(...numberList) : undefined };
};
