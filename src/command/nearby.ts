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

/**
 * The genre shortcuts on this page are slugs (`ramen`, `yakiniku`, `kushiage`),
 * not the codes the search list takes (`MC01`), and the page itself is the only
 * place that lists them. Page numbers go after the slug: `/ramen/2/`.
 */
const pageUrl = (ref: RestaurantRef, locale: Locale, page: number, genreSlug: string | undefined): string => {
  const genrePart = genreSlug ? `${genreSlug}/` : "";
  const pagePart = page > 1 ? `${page}/` : "";
  return localeUrl(locale, `${ref.path}/peripheral_map/${genrePart}${pagePart}`);
};

export interface NearbyGenre {
  slug: string;
  label: string;
}

export const parseNearbyGenreList = (html: string): NearbyGenre[] => {
  const seen = new Set<string>();
  const list: NearbyGenre[] = [];
  for (const match of html.matchAll(/peripheral_map\/([a-z0-9_]+)\/">([^<]*)</g)) {
    const slug = match[1] ?? "";
    if (!slug || /^\d+$/.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    list.push({ slug, label: (match[2] ?? "").trim() });
  }
  return list;
};

const genreSlugOf = async (wanted: string, genreList: NearbyGenre[]): Promise<NearbyGenre> => {
  const needle = wanted.trim().toLowerCase();
  const direct = genreList.find((genre) => genre.slug === needle || genre.label.toLowerCase().includes(needle));
  if (direct) return direct;
  // A Japanese or Korean name resolves through the suggest index to Tabelog's
  // English label, which is what the page prints.
  const suggested = await suggestGenre(wanted);
  if (suggested) {
    const head = suggested.name.split(/[,(]/)[0]?.trim().toLowerCase() ?? "";
    const viaLabel = genreList.find(
      (genre) => genre.label.toLowerCase().includes(head) || genre.slug === suggested.code.toLowerCase(),
    );
    if (viaLabel) return viaLabel;
  }
  throw new Error(
    `"${wanted}" is not one of the genres this page offers. Available: ${genreList.map((genre) => genre.label).join(", ")}`,
  );
};

export const nearby = async (
  input: string,
  option: { genre?: string; pages?: number; locale: Locale },
): Promise<NearbyResult> => {
  const ref = await resolveRestaurant(input);
  const pageCount = Math.min(MAX_PAGE, Math.max(1, Math.floor(option.pages ?? MAX_PAGE)));

  // The first page is always read: it is page 1 of the unfiltered list and the
  // only source of the genre slugs.
  const [anchorPage, firstBody] = await Promise.all([
    detailOf(ref, "en"),
    fetchHtml(pageUrl(ref, option.locale, 1, undefined)).then((res) => res.body),
  ]);

  let genreSlug: string | undefined;
  let resolvedGenre: string | undefined;
  if (option.genre) {
    const genre = await genreSlugOf(option.genre, parseNearbyGenreList(firstBody));
    genreSlug = genre.slug;
    resolvedGenre = `${genre.label} (${genre.slug})`;
  }

  const pageList = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => genreSlug !== undefined || page > 1,
  );
  const restList = await mapLimit(
    pageList,
    3,
    async (page) => (await fetchHtml(pageUrl(ref, option.locale, page, genreSlug))).body,
  );
  const htmlList = genreSlug === undefined ? [firstBody, ...restList] : restList;

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
  if (anchor) {
    itemList.sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY));
  }

  return { anchorId: ref.id, url: pageUrl(ref, option.locale, 1, genreSlug), resolvedGenre, pageCount, itemList };
};
