/**
 * HTTP layer. Tabelog fronts the Japanese site with a Cloudflare challenge that
 * rejects curl and Bun alike, but the inbound locales (/en/, /kr/, /tw/, /cn/,
 * /th/) are served plain to a browser-looking user agent. Everything here goes
 * through those locales; the Japanese path is only ever used for redirects.
 */

export const BASE_URL = "https://tabelog.com";

export const LOCALE_LIST = ["en", "kr", "tw", "cn", "th"] as const;
export type Locale = (typeof LOCALE_LIST)[number];
export const DEFAULT_LOCALE: Locale = "en";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const HTML_HEADER = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en,ja;q=0.9",
};

// The suggest endpoint answers 400 without these two; it is wired for XHR only.
const JSON_HEADER = {
  "user-agent": USER_AGENT,
  accept: "application/json, text/javascript, */*; q=0.01",
  "x-requested-with": "XMLHttpRequest",
  referer: `${BASE_URL}/en/`,
};

export const isLocale = (value: unknown): value is Locale => {
  return typeof value === "string" && (LOCALE_LIST as readonly string[]).includes(value);
};

export const localeUrl = (locale: Locale, path: string): string => {
  return `${BASE_URL}/${locale}/${path.replace(/^\/+/, "")}`;
};

const assertNotChallenged = (status: number, body: string, url: string): void => {
  if (body.includes("<title>Just a moment...</title>")) {
    throw new Error(
      `Cloudflare challenge at ${url}. Only /en/ /kr/ /tw/ /cn/ /th/ pages are reachable without a browser.`,
    );
  }
  if (status === 404) {
    throw new Error(`HTTP 404 for ${url}. The restaurant or page does not exist, or the id is wrong.`);
  }
  if (status >= 400) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
};

/**
 * Tabelog occasionally answers 429 or a 5xx under load, and Overpass-style
 * transient failures are common enough that one blind retry after a short
 * pause turns most of them into a normal answer. Anything else is returned as
 * is; a 4xx other than 429 is the caller's problem, not the network's.
 */
const RETRY_STATUS_SET = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 1500;

const fetchWithRetry = async (url: string, init: RequestInit): Promise<Response> => {
  const first = await fetch(url, init);
  if (!RETRY_STATUS_SET.has(first.status)) return first;
  await first.arrayBuffer();
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return fetch(url, init);
};

export const fetchHtml = async (url: string): Promise<{ url: string; body: string }> => {
  const res = await fetchWithRetry(url, { headers: HTML_HEADER, redirect: "follow" });
  const body = await res.text();
  assertNotChallenged(res.status, body, url);
  return { url: res.url, body };
};

export const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetchWithRetry(url, { headers: JSON_HEADER });
  const body = await res.text();
  assertNotChallenged(res.status, body, url);
  return JSON.parse(body) as T;
};

/** Follow one redirect hop by hand and return where it points, or undefined when it does not redirect. */
export const fetchRedirectLocation = async (url: string): Promise<string | undefined> => {
  const res = await fetch(url, { headers: HTML_HEADER, redirect: "manual" });
  await res.arrayBuffer();
  if (res.status >= 300 && res.status < 400) {
    return res.headers.get("location") ?? undefined;
  }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return undefined;
};
