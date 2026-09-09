import { distanceM, type GeoPoint, mapLimit } from "../geo";
import { openStatusAt } from "../hour";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { parseJapanTime, toSvd, toSvt, type WallClock } from "../time";
import { resolveRestaurant } from "../url";
import { parseCardList, parseCount, type SearchItem, stationDistanceOf } from "./card";
import { type Detail, detailOf } from "./detail";
import { locate } from "./locate";
import { type AreaSuggest, suggestArea, suggestGenre } from "./suggest";

export type { SearchItem } from "./card";

export const SORT_LIST = ["rating", "access", "reserved"] as const;
export type Sort = (typeof SORT_LIST)[number];

// SrtT values the /en/ list page offers. "rt" is the Tabelog score, the other
// two are inbound-only orderings the sort tabs expose.
const SORT_CODE_MAP: Record<Sort, string> = {
  rating: "rt",
  access: "inbound_access",
  reserved: "inbound_most_reserved",
};

export const isSort = (value: unknown): value is Sort => {
  return typeof value === "string" && (SORT_LIST as readonly string[]).includes(value);
};

export const ORDER_LIST = ["site", "distance", "review_count", "rating"] as const;
export type Order = (typeof ORDER_LIST)[number];

export const isOrder = (value: unknown): value is Order => {
  return typeof value === "string" && (ORDER_LIST as readonly string[]).includes(value);
};

export const MEAL_LIST = ["dinner", "lunch"] as const;
export type Meal = (typeof MEAL_LIST)[number];

export const isMeal = (value: unknown): value is Meal => {
  return typeof value === "string" && (MEAL_LIST as readonly string[]).includes(value);
};

/**
 * Budget bands behind LstCos (lower) / LstCosT (upper), verified against the
 * prices the filtered list returns. Index 0 means no bound. There is no band
 * for "under 1,000" on the inbound site, so a ceiling below 1,000 still lets
 * 1,000-1,999 through.
 */
const BUDGET_BAND_LIST: { index: number; min: number; max: number }[] = [
  { index: 1, min: 1000, max: 1999 },
  { index: 2, min: 2000, max: 2999 },
  { index: 3, min: 3000, max: 3999 },
  { index: 4, min: 4000, max: 4999 },
  { index: 5, min: 5000, max: 5999 },
  { index: 6, min: 6000, max: 7999 },
  { index: 7, min: 8000, max: 9999 },
  { index: 8, min: 10000, max: 14999 },
  { index: 9, min: 15000, max: 19999 },
  { index: 10, min: 20000, max: 29999 },
  { index: 11, min: 30000, max: 39999 },
  { index: 12, min: 40000, max: 49999 },
  { index: 13, min: 50000, max: 59999 },
  { index: 14, min: 60000, max: 79999 },
  { index: 15, min: 80000, max: 99999 },
  { index: 16, min: 100000, max: Number.POSITIVE_INFINITY },
];

const bandContaining = (yen: number): number => {
  return BUDGET_BAND_LIST.find((band) => yen >= band.min && yen <= band.max)?.index ?? 0;
};

export interface BudgetOption {
  meal: Meal;
  /** Yen. */
  min?: number;
  max?: number;
}

export interface VacancyFilter {
  /** YYYY-MM-DD. Defaults to today in Japan. */
  date?: string;
  /** HH:MM. Defaults to 19:00. */
  time?: string;
  /** Party size. Defaults to 2. */
  people?: number;
}

export interface NearOption {
  point: GeoPoint;
  /** Metres. Results farther than this are dropped. Omit to keep all, sorted by distance. */
  radiusM?: number;
}

export interface SearchOption {
  /** Area name in English or Japanese: a station, town, ward, city or prefecture. Resolved via suggest. Optional when near is given. */
  area?: string;
  /** Genre name in English or Japanese. Resolved via suggest. */
  genre?: string;
  /** Free-text words the list page matches against names and menus (sw=). */
  keyword?: string;
  sort?: Sort;
  page?: number;
  /** How many consecutive list pages to read from `page`. 1, or 5 for a radius scan (which stops early). Max 10. */
  pages?: number;
  budget?: BudgetOption;
  /** Only restaurants with an online-bookable table at that date/time/party size. */
  vacancy?: VacancyFilter;
  /** Sort (and optionally cut) by straight-line distance from a point. Costs one page fetch per result. */
  near?: NearOption;
  /** Keep only restaurants open at this Japan wall-clock time ("now" or "YYYY-MM-DD HH:MM"). Costs one page fetch per result. */
  openAt?: string;
  minRating?: number;
  minReviewCount?: number;
  /** Substrings every kept restaurant's English feature tags must contain ("non smoking", "credit card", "wi-fi"). */
  featureList?: string[];
  /** Only restaurants carrying a Tabelog Award or Tabelog 100 badge. */
  award?: boolean;
  /** Detail-table filters; each costs one page fetch per result. */
  privateRoom?: boolean;
  parking?: boolean;
  /** Stop a radius scan once this many are kept, and cut the final list to it. */
  limit?: number;
  /** Final ordering of the kept results. Defaults to the site order, or distance when near is given. */
  order?: Order;
  locale: Locale;
}

export interface SearchResult {
  url: string;
  resolvedArea: string | undefined;
  resolvedGenre: string | undefined;
  noteList: string[];
  from: number | undefined;
  to: number | undefined;
  total: number | undefined;
  page: number;
  pageCount: number;
  /** How many cards were read before post-filters. */
  scannedCount: number;
  itemList: SearchItem[];
}

const MAX_PAGE_COUNT = 10;
const DETAIL_CONCURRENCY = 6;
/** A radius scan stops once this many restaurants are kept, unless `limit` says otherwise. */
const DEFAULT_LIMIT = 20;

const applyArea = (query: URLSearchParams, area: AreaSuggest): void => {
  query.set("pal", area.pal);
  query.set("LstPrf", area.lstPrf);
  query.set("LstAre", area.lstAre);
  query.set("station_id", area.stationId);
  query.set("area_datatype", area.datatype);
  query.set("area_id", area.id);
};

const applyBudget = (query: URLSearchParams, budget: BudgetOption): string => {
  query.set("RdoCosTp", budget.meal === "dinner" ? "2" : "1");
  const lower = budget.min === undefined ? 0 : bandContaining(budget.min);
  const upper = budget.max === undefined ? 0 : bandContaining(Math.max(budget.max, 1000));
  if (lower) query.set("LstCos", String(lower));
  if (upper) query.set("LstCosT", String(upper));
  const lowerText = budget.min === undefined ? "" : `from JPY ${budget.min.toLocaleString("en-US")}`;
  const upperText = budget.max === undefined ? "" : `up to JPY ${budget.max.toLocaleString("en-US")}`;
  return `budget: ${budget.meal} ${[lowerText, upperText].filter(Boolean).join(" ")} (Tabelog bands ${lower || "-"}..${upper || "-"})`;
};

const applyVacancy = (query: URLSearchParams, vacancy: VacancyFilter): string => {
  const svd = toSvd(vacancy.date);
  const svt = toSvt(vacancy.time ?? "19:00");
  const people = vacancy.people && vacancy.people > 0 ? Math.floor(vacancy.people) : 2;
  query.set("svd", svd);
  query.set("svt", svt);
  query.set("svps", String(people));
  query.set("vac_net", "1");
  return `vacancy: online-bookable on ${svd.slice(0, 4)}-${svd.slice(4, 6)}-${svd.slice(6, 8)} at ${svt.slice(0, 2)}:${svt.slice(2)} for ${people}`;
};

const normalizeStation = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\s*(sta\.|station)\s*$/i, "")
    .replace(/[\s\-\u30fb]/g, "");
};

/**
 * Station labels differ between sources for the same place: OSM says "Namba",
 * Tabelog's area is "Osaka Namba Sta." and a card may say "Kobe Sannomiya".
 * Containment either way is close enough to trust the card's metre figure.
 */
const sameStation = (left: string, right: string): boolean => {
  const a = normalizeStation(left);
  const b = normalizeStation(right);
  return a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));
};

const infoValue = (page: Detail, labelPattern: RegExp): string | undefined => {
  return page.infoList.find((row) => labelPattern.test(row.label))?.value;
};

/** "Available", "Unavailable", "None" and their variants, read from a detail-table cell. */
const isAvailable = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const head = value.split("\n")[0]?.trim().toLowerCase() ?? "";
  return head.length > 0 && !/^(unavailable|none|no\b|not available|-)/.test(head);
};

interface EnrichOption {
  near: NearOption | undefined;
  at: WallClock | undefined;
  wantPrivateRoom: boolean;
  wantParking: boolean;
}

/**
 * near, openAt, privateRoom and parking all need the restaurant page
 * (coordinates live in its JSON-LD, hours and facilities in its info table),
 * so one fetch per card serves all of them.
 */
const enrich = async (itemList: SearchItem[], option: EnrichOption): Promise<SearchItem[]> => {
  return mapLimit(itemList, DETAIL_CONCURRENCY, async (item) => {
    try {
      const page = await detailOf(await resolveRestaurant(item.url), "en");
      const hasGeo = page.latitude !== undefined && page.longitude !== undefined;
      return {
        ...item,
        distanceM:
          option.near && hasGeo
            ? distanceM(option.near.point, { latitude: page.latitude as number, longitude: page.longitude as number })
            : undefined,
        openStatus: option.at ? openStatusAt(page.hourList, option.at) : undefined,
        hourList: option.at ? page.hourList : undefined,
        privateRoom: option.wantPrivateRoom ? infoValue(page, /private room/i) : undefined,
        parking: option.wantParking ? infoValue(page, /^parking/i) : undefined,
      };
    } catch {
      // A single page failing must not sink the whole search; the card stays with unknowns.
      return { ...item, openStatus: option.at ? "unknown" : undefined };
    }
  });
};

const fetchCardList = async (
  locale: Locale,
  query: URLSearchParams,
  page: number,
): Promise<{ url: string; itemList: SearchItem[]; count: Pick<SearchResult, "from" | "to" | "total"> }> => {
  const path = page > 1 ? `rstLst/${page}/` : "rstLst/";
  const url = `${localeUrl(locale, path)}?${query.toString()}`;
  const { body } = await fetchHtml(url);
  const itemList = parseCardList(body);
  const count = parseCount(body);
  // A genuinely empty result still renders the counter (0). Neither cards nor a
  // counter means the markup moved, and that must not pass as "no results".
  if (!itemList.length && count.total === undefined) {
    throw new Error(`Could not find result cards or a result count at ${url}. Tabelog markup may have changed.`);
  }
  return { url, itemList, count };
};

export const search = async (option: SearchOption): Promise<SearchResult> => {
  if (!option.area && !option.genre && !option.keyword && !option.near) {
    throw new Error("Give at least one of area, genre, keyword or near.");
  }
  const firstPage = option.page && option.page > 1 ? Math.floor(option.page) : 1;
  // A radius search deserves a wider net by default: the list is in score order, not distance order.
  const pageCount = Math.min(
    MAX_PAGE_COUNT,
    Math.max(1, Math.floor(option.pages ?? (option.near?.radiusM !== undefined ? 5 : 1))),
  );
  const noteList: string[] = [];

  const query = new URLSearchParams();
  query.set("SrtT", SORT_CODE_MAP[option.sort ?? "rating"]);

  // Area: named, or derived from the coordinates when only `near` was given.
  let resolvedArea: string | undefined;
  /** The station `near` was measured against, with every name it goes by, for the distance shortcut. */
  let stationPoint: (GeoPoint & { nameList: string[]; name: string; distanceM: number }) | undefined;
  if (option.area) {
    const area = await suggestArea(option.area);
    if (!area) throw new Error(`No Tabelog area matches "${option.area}". Try an English or Japanese place name.`);
    resolvedArea = `${area.name} (${area.datatype})`;
    applyArea(query, area);
  } else if (option.near) {
    const located = await locate(option.near.point);
    const best = located.candidateList[0];
    if (!best) throw new Error("locate returned no candidate");
    applyArea(query, best.area);
    resolvedArea = `${best.area.name} (${best.area.datatype}), picked from coordinates${
      best.distanceM === undefined ? "" : `, ${best.distanceM}m from the point`
    }`;
    if (best.station) {
      const name = best.station.nameEn ?? best.station.name;
      stationPoint = {
        latitude: best.station.latitude,
        longitude: best.station.longitude,
        name,
        // OSM's name, its English name and Tabelog's own label for the same
        // station all differ; a card may print any of them.
        nameList: [...new Set([name, best.station.name, best.area.name.replace(/\uff08[^\uff09]*\uff09/, "")])],
        distanceM: best.station.distanceM,
      };
    }
  }

  // The genre index only knows Tabelog's own labels ("Kushi-age", not
  // "kushikatsu"); Japanese names resolve far more often. When a genre is not
  // in the index it is still a useful search word, so it falls back to sw and
  // the result says so rather than failing the whole search.
  const wordList = option.keyword ? [option.keyword.trim()] : [];
  let resolvedGenre: string | undefined;
  if (option.genre) {
    const genre = await suggestGenre(option.genre);
    if (genre) {
      resolvedGenre = `${genre.name} (${genre.code})`;
      query.set("genre_name", genre.code);
    } else {
      resolvedGenre = `"${option.genre}" is not a Tabelog genre; searched as a keyword instead`;
      wordList.push(option.genre.trim());
    }
  }
  if (wordList.length) query.set("sw", wordList.join(" "));

  if (option.budget) noteList.push(applyBudget(query, option.budget));
  if (option.vacancy) noteList.push(applyVacancy(query, option.vacancy));

  const wantFeature = (option.featureList?.length ?? 0) > 0;
  const wantList = (option.featureList ?? []).map((text) => text.trim().toLowerCase()).filter(Boolean);
  const near = option.near;
  const at = option.openAt === undefined ? undefined : parseJapanTime(option.openAt);
  const wantPrivateRoom = option.privateRoom === true;
  const wantParking = option.parking === true;
  const wantDetail = near !== undefined || at !== undefined || wantPrivateRoom || wantParking;
  // The feature filter and the station-distance shortcut both need Tabelog's
  // English wording, so on another locale the English page is read as well and
  // joined by restaurant id. One list request against twenty detail requests.
  const wantEnglishCard =
    option.locale !== "en" && (wantFeature || (near?.radiusM !== undefined && stationPoint !== undefined));
  const stopAt = option.limit ?? DEFAULT_LIMIT;

  let firstUrl = "";
  let firstCount: ReturnType<typeof parseCount> = { from: undefined, to: undefined, total: undefined };
  let scannedCount = 0;
  let stationSkipped = 0;
  let closedDropped = 0;
  let pageRead = 0;

  /** One list page through every filter. Returns how many cards the page had (0 means past the end). */
  const processPage = async (page: number): Promise<{ cardCount: number; keptList: SearchItem[] }> => {
    const [local, english] = await Promise.all([
      fetchCardList(option.locale, query, page),
      wantEnglishCard ? fetchCardList("en", query, page) : Promise.resolve(undefined),
    ]);
    if (page === firstPage) {
      firstUrl = local.url;
      firstCount = local.count;
    }
    pageRead += 1;
    const englishCardMap = new Map((english?.itemList ?? []).map((item) => [item.id, item]));
    const englishOf = (item: SearchItem): SearchItem => englishCardMap.get(item.id) ?? item;

    let itemList = local.itemList;
    scannedCount += itemList.length;

    // Cheap filters first, from what the cards already say.
    if (option.minRating !== undefined) {
      const min = option.minRating;
      itemList = itemList.filter((item) => item.rating !== undefined && item.rating >= min);
    }
    if (option.minReviewCount !== undefined) {
      const min = option.minReviewCount;
      itemList = itemList.filter((item) => (item.reviewCount ?? 0) >= min);
    }
    if (option.award) itemList = itemList.filter((item) => item.awardList.length > 0);
    if (wantFeature) {
      itemList = itemList.filter((item) => {
        const tagText = englishOf(item).featureList.join(" | ").toLowerCase();
        return wantList.every((want) => tagText.includes(want));
      });
    }

    // Before paying a page fetch per card, drop cards whose own "Station NNNm"
    // proves they cannot be inside the radius: a restaurant within r of the
    // point is within r + d(point, station) of that station. Only the station
    // the point was measured from bounds anything; a card measured from some
    // other station says nothing about this radius.
    if (near?.radiusM !== undefined && stationPoint) {
      const bound = near.radiusM + stationPoint.distanceM;
      const station = stationPoint;
      const before = itemList.length;
      itemList = itemList.filter((item) => {
        const shown = stationDistanceOf(englishOf(item));
        if (!shown || !station.nameList.some((name) => sameStation(shown.station, name))) return true;
        return shown.metre <= bound;
      });
      stationSkipped += before - itemList.length;
    }

    if (wantDetail && itemList.length) {
      itemList = await enrich(itemList, { near, at, wantPrivateRoom, wantParking });
      if (near) {
        itemList = itemList.filter(
          (item) => item.distanceM !== undefined && (near.radiusM === undefined || item.distanceM <= near.radiusM),
        );
      }
      if (at) {
        const before = itemList.length;
        itemList = itemList.filter((item) => item.openStatus !== "closed");
        closedDropped += before - itemList.length;
      }
      if (wantPrivateRoom) itemList = itemList.filter((item) => isAvailable(item.privateRoom));
      if (wantParking) itemList = itemList.filter((item) => isAvailable(item.parking));
    }
    return { cardCount: local.itemList.length, keptList: itemList };
  };

  // A radius search walks pages one at a time and stops as soon as it has
  // enough, because the list is in score order and most of a page can be
  // outside the circle. Everything else reads its pages concurrently.
  let itemList: SearchItem[] = [];
  let stoppedEarly = false;
  if (near?.radiusM !== undefined) {
    for (let page = firstPage; page < firstPage + pageCount; page++) {
      const result = await processPage(page);
      itemList.push(...result.keptList);
      if (result.cardCount === 0) break;
      if (itemList.length >= stopAt) {
        stoppedEarly = page < firstPage + pageCount - 1;
        break;
      }
    }
  } else {
    const pageList = Array.from({ length: pageCount }, (_, index) => firstPage + index);
    const resultList = await mapLimit(pageList, 3, processPage);
    itemList = resultList.flatMap((result) => result.keptList);
  }

  if (pageRead > 1 || pageCount > 1) {
    noteList.push(
      `read ${pageRead} page${pageRead === 1 ? "" : "s"} (${scannedCount} restaurants) from page ${firstPage}${
        stoppedEarly ? `, stopped once ${stopAt} were kept` : ""
      }`,
    );
  }
  if (option.minRating !== undefined) noteList.push(`rating >= ${option.minRating}`);
  if (option.minReviewCount !== undefined) noteList.push(`reviews >= ${option.minReviewCount}`);
  if (option.award) noteList.push("awarded (Tabelog Award or Tabelog 100) only");
  if (wantFeature) noteList.push(`features: ${wantList.join(", ")}`);
  if (stationSkipped && stationPoint) {
    noteList.push(`${stationSkipped} skipped by their listed distance from ${stationPoint.name}`);
  }
  if (near) {
    noteList.push(
      `near: ${near.point.latitude},${near.point.longitude}${near.radiusM === undefined ? "" : ` within ${near.radiusM}m`}`,
    );
  }
  if (at) noteList.push(`open at ${at.label}: ${closedDropped} closed dropped, "unknown" kept (no parsable hours)`);
  if (wantPrivateRoom) noteList.push("private room: available");
  if (wantParking) noteList.push("parking: available");

  // The list is in score order over the whole area, so a tight radius keeps few
  // of any one page. Say so rather than letting a short list read as "that is all".
  if (near?.radiusM !== undefined && itemList.length < 5 && pageRead < MAX_PAGE_COUNT && !stoppedEarly) {
    noteList.push(
      `only ${itemList.length} within the radius on these pages; raise pages (up to ${MAX_PAGE_COUNT}) to scan further`,
    );
  }

  const order: Order = option.order ?? (near ? "distance" : "site");
  if (order === "distance") {
    itemList.sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY));
  } else if (order === "review_count") {
    itemList.sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  } else if (order === "rating") {
    itemList.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }
  if (order !== "site") noteList.push(`ordered by ${order}`);

  if (option.limit !== undefined && itemList.length > option.limit) {
    noteList.push(`showing the first ${option.limit} of ${itemList.length} kept`);
    itemList = itemList.slice(0, option.limit);
  }

  return {
    url: firstUrl,
    resolvedArea,
    resolvedGenre,
    noteList,
    ...firstCount,
    page: firstPage,
    pageCount: pageRead,
    scannedCount,
    itemList,
  };
};
