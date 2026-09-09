import { distanceM, mapLimit } from "../geo";
import { attrOf, classText, splitBy, toNumber } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { type RestaurantRef, resolveRestaurant } from "../url";
import { detailOf } from "./detail";
import { suggestGenre } from "./suggest";

/**
 * "Find nearby restaurants" on a restaurant page: /peripheral_map/ lists the
 * closest restaurants five to a page with their pins' coordinates in a
 * data-gmaps-lat/lng pair of arrays. Up to five pages exist, so this is
 * Tabelog's own 25-nearest list anchored on a restaurant.
 */

export interface NearbyItem {
  id: string;
  name: string;
  url: string;
  /** "Sannomiya / Steak, Creative" */
  areaGenre: string | undefined;
  rating: number | undefined;
  reviewCount: number | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  distanceM: number | undefined;
}

export interface NearbyResult {
  anchorId: string;
  url: string;
  resolvedGenre: string | undefined;
  pageCount: number;
  itemList: NearbyItem[];
}

const MAX_PAGE = 5;
const ITEM_MARKER = '<div class="mappoint-list__item">';

const parseNumberList = (html: string, attr: string): number[] => {
  const raw = attrOf(html, attr);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
};

const parsePage = (html: string): NearbyItem[] => {
  const pin = /<div id="js-array"[^>]*>/.exec(html)?.[0] ?? "";
  const latList = parseNumberList(pin, "data-gmaps-lat");
  const lngList = parseNumberList(pin, "data-gmaps-lng");
  return splitBy(html, ITEM_MARKER)
    .map((chunk, index): NearbyItem | undefined => {
      const anchor = /<h5 class="mappoint-list__mname">\s*<a href="([^"]*)">([\s\S]*?)<\/a>/.exec(chunk);
      const url = anchor?.[1];
      const id = url === undefined ? undefined : /\/(\d+)\/?$/.exec(url)?.[1];
      if (!url || !id || !anchor?.[2]) return undefined;
      const latitude = latList[index];
      const longitude = lngList[index];
      return {
        id,
        name: anchor[2].trim(),
        url,
        areaGenre: classText(chunk, "mappoint-list__area-catg"),
        rating: toNumber(classText(chunk, "mappoint-list__rating-num")),
        reviewCount: toNumber(classText(chunk, "mappoint-list__count-num")),
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        longitude: Number.isFinite(longitude) ? longitude : undefined,
        distanceM: undefined,
      };
    })
    .filter((item): item is NearbyItem => item !== undefined);
};

const pageUrl = (ref: RestaurantRef, locale: Locale, page: number, genreCode: string | undefined): string => {
  const genrePart = genreCode ? `${genreCode}/` : "";
  const pagePart = page > 1 ? `${page}/` : "";
  return localeUrl(locale, `${ref.path}/peripheral_map/${pagePart}${genrePart}`);
};

export const nearby = async (
  input: string,
  option: { genre?: string; pages?: number; locale: Locale },
): Promise<NearbyResult> => {
  const ref = await resolveRestaurant(input);
  const pageCount = Math.min(MAX_PAGE, Math.max(1, Math.floor(option.pages ?? MAX_PAGE)));

  let genreCode: string | undefined;
  let resolvedGenre: string | undefined;
  if (option.genre) {
    const genre = await suggestGenre(option.genre);
    if (!genre) throw new Error(`No Tabelog genre matches "${option.genre}".`);
    genreCode = genre.code;
    resolvedGenre = `${genre.name} (${genre.code})`;
  }

  const pageList = Array.from({ length: pageCount }, (_, index) => index + 1);
  const [anchorPage, htmlList] = await Promise.all([
    detailOf(ref, "en"),
    mapLimit(pageList, 3, async (page) => (await fetchHtml(pageUrl(ref, option.locale, page, genreCode))).body),
  ]);
  const seen = new Set<string>();
  const itemList = htmlList
    .flatMap(parsePage)
    .filter((item) => item.id !== ref.id && !seen.has(item.id) && seen.add(item.id));

  // Distances are from the anchor restaurant itself; the peripheral page carries only pins, not distances.
  const anchor =
    anchorPage.latitude !== undefined && anchorPage.longitude !== undefined
      ? { latitude: anchorPage.latitude, longitude: anchorPage.longitude }
      : undefined;
  for (const item of itemList) {
    if (anchor && item.latitude !== undefined && item.longitude !== undefined) {
      item.distanceM = distanceM(anchor, { latitude: item.latitude, longitude: item.longitude });
    }
  }
  if (anchor)
    itemList.sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY));

  return { anchorId: ref.id, url: pageUrl(ref, option.locale, 1, genreCode), resolvedGenre, pageCount, itemList };
};
