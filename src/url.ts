import { BASE_URL, fetchRedirectLocation, type Locale, localeUrl } from "./http";

/**
 * A restaurant lives at /{pref}/{A-area1}/{A-area2}/{id}/ under any locale.
 * The path segments are needed to build a URL, so an id alone has to be
 * resolved through the redirect Tabelog provides at /en/rstdtl/{id}/.
 */

const RESTAURANT_PATH = /(?:^|\/)([a-z]+\/A\d{4}\/A\d{6}\/(\d+))\/?/;

export interface RestaurantRef {
  id: string;
  /** "hyogo/A2801/A280101/28043837" */
  path: string;
}

const refFromPath = (pathOrUrl: string): RestaurantRef | undefined => {
  const match = RESTAURANT_PATH.exec(pathOrUrl);
  const path = match?.[1];
  const id = match?.[2];
  return path !== undefined && id !== undefined ? { id, path } : undefined;
};

/**
 * Accepts a Tabelog restaurant URL (any locale or the Japanese site), a bare
 * path, or a numeric restaurant id.
 */
export const resolveRestaurant = async (input: string): Promise<RestaurantRef> => {
  const trimmed = input.trim();
  const direct = refFromPath(trimmed);
  if (direct) return direct;

  if (/^\d+$/.test(trimmed)) {
    const location = await fetchRedirectLocation(`${BASE_URL}/en/rstdtl/${trimmed}/`);
    const resolved = location === undefined ? undefined : refFromPath(location);
    if (resolved) return resolved;
    throw new Error(`Restaurant ${trimmed} did not resolve to a Tabelog page.`);
  }

  throw new Error(`Not a Tabelog restaurant URL or id: ${input}`);
};

export const detailUrl = (ref: RestaurantRef, locale: Locale): string => {
  return localeUrl(locale, `${ref.path}/`);
};

export const reviewListUrl = (
  ref: RestaurantRef,
  locale: Locale,
  option: { page: number; useType: 0 | 1 | 2; sortByVisit: boolean },
): string => {
  const query = new URLSearchParams({
    PG: String(option.page),
    lc: "0",
    rvw_part: "all",
    smp: "1",
    use_type: String(option.useType),
  });
  if (option.sortByVisit) {
    query.set("srt", "visit");
    query.set("sby", "D");
  }
  return `${localeUrl(locale, `${ref.path}/dtlrvwlst/`)}?${query.toString()}`;
};

export const MENU_KIND_LIST = ["food", "lunch", "drink"] as const;
export type MenuKind = (typeof MENU_KIND_LIST)[number];

/** /dtlmenu/ is the food menu; lunch and drink hang under it. Course pages 404 on the inbound site. */
export const menuUrl = (ref: RestaurantRef, locale: Locale, kind: MenuKind): string => {
  return localeUrl(locale, `${ref.path}/dtlmenu/${kind === "food" ? "" : `${kind}/`}`);
};

export const ratingUrl = (ref: RestaurantRef, locale: Locale): string => {
  return localeUrl(locale, `${ref.path}/dtlratings/`);
};

export const PHOTO_MODE_LIST = ["all", "owner", "user"] as const;
export type PhotoMode = (typeof PHOTO_MODE_LIST)[number];

/** The list layout paginates with ?PG=; the grid layout (smp2) uses different markup and is not read. */
export const photoUrl = (ref: RestaurantRef, locale: Locale, option: { page: number; mode: PhotoMode }): string => {
  const query = new URLSearchParams();
  if (option.page > 1) query.set("PG", String(option.page));
  if (option.mode !== "all") query.set("mode", option.mode);
  const base = localeUrl(locale, `${ref.path}/dtlphotolst/`);
  const text = query.toString();
  return text ? `${base}?${text}` : base;
};

/** The booking calendar endpoints the reservation modal calls. All take rst_id plus svd/svps/svt. */
export const bookingUrl = (
  endpoint: "find_vacancy_date_with_status" | "find_vacancy" | "find_vacancy_member_by_date",
  query: Record<string, string>,
): string => {
  return `${localeUrl("en", `booking/calendar/${endpoint}/`)}?${new URLSearchParams(query).toString()}`;
};

export const absoluteUrl = (pathOrUrl: string): string => {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
};
