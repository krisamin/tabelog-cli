import { distanceM, type GeoPoint, mapLimit } from "../geo";
import { type HourGroup, type OpenStatus, openStatusAt } from "../hour";
import { attrOf, classText, pick, pickAll, splitBy, toNumber } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { parseJapanTime, toSvd, toSvt, type WallClock } from "../time";
import { resolveRestaurant } from "../url";
import { detailOf } from "./detail";
import { suggestArea, suggestGenre } from "./suggest";

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
  /** Area name in English or Japanese: a station, town, ward, city or prefecture. Resolved via suggest. */
  area?: string;
  /** Genre name in English or Japanese. Resolved via suggest. */
  genre?: string;
  /** Free-text words the list page matches against names and menus (sw=). */
  keyword?: string;
  sort?: Sort;
  page?: number;
  budget?: BudgetOption;
  /** Only restaurants with an online-bookable table at that date/time/party size. */
  vacancy?: VacancyFilter;
  /** Sort (and optionally cut) by straight-line distance from a point. Costs one page fetch per result. */
  near?: NearOption;
  /** Keep only restaurants open at this Japan wall-clock time ("now" or "YYYY-MM-DD HH:MM"). Costs one page fetch per result. */
  openAt?: string;
  locale: Locale;
}

export interface SearchItem {
  rank: number | undefined;
  id: string;
  name: string;
  url: string;
  /** "Sannomiya Sta. 450m / Ramen, Dumpling, Chinese" */
  areaGenre: string | undefined;
  rating: number | undefined;
  reviewCount: number | undefined;
  dinnerPrice: string | undefined;
  lunchPrice: string | undefined;
  holiday: string | undefined;
  awardList: string[];
  catchphrase: string | undefined;
  featureList: string[];
  /** Filled when `near` was given. */
  distanceM: number | undefined;
  /** Filled when `openAt` was given. */
  openStatus: OpenStatus | undefined;
  hourList: HourGroup[] | undefined;
}

export interface SearchResult {
  url: string;
  resolvedArea: string | undefined;
  resolvedGenre: string | undefined;
  budgetNote: string | undefined;
  vacancyNote: string | undefined;
  nearNote: string | undefined;
  openAtNote: string | undefined;
  from: number | undefined;
  to: number | undefined;
  total: number | undefined;
  page: number;
  /** How many cards the page had before near/openAt post-filters. */
  pageCount: number;
  itemList: SearchItem[];
}

const CARD_MARKER = '<div class="list-rst js-bookmark js-rst-cassette-wrap"';

const priceOf = (card: string, time: "dinner" | "lunch"): string | undefined => {
  return pick(card, new RegExp(`c-rating-v3__time--${time}"[^>]*></i><span class="c-rating-v3__val">([^<]*)<`));
};

const parseCard = (card: string): SearchItem | undefined => {
  const id = attrOf(card, "data-rst-id");
  const url = attrOf(card, "data-detail-url");
  const name = pick(card, /list-rst__rst-name-target[^>]*>([\s\S]*?)<\/a>/);
  if (!id || !url || !name) return undefined;

  const ratingText = classText(card, "list-rst__rating-val");
  return {
    rank: toNumber(classText(card, "c-ranking-badge__contents")),
    id,
    name,
    url,
    areaGenre: classText(card, "list-rst__area-genre"),
    rating: ratingText === "-" ? undefined : toNumber(ratingText),
    reviewCount: toNumber(classText(card, "list-rst__rvw-count-num")),
    dinnerPrice: priceOf(card, "dinner"),
    lunchPrice: priceOf(card, "lunch"),
    holiday: classText(card, "list-rst__holiday-text"),
    awardList: pickAll(card, /class="c-badge-(?:award|hyakumeiten)[^"]*"><i>([^<]*)<\/i>/g),
    catchphrase: classText(card, "list-rst__pr-title"),
    featureList: pickAll(card, /list-rst__search-word-item">([\s\S]*?)<\/li>/g),
    distanceM: undefined,
    openStatus: undefined,
    hourList: undefined,
  };
};

/**
 * "1 - 20 / 146" normally; an empty result renders "0 results / 0 results" with
 * only two numbers and a rstlist-notfound block instead of cards.
 */
const parseCount = (html: string): Pick<SearchResult, "from" | "to" | "total"> => {
  const numberList = pickAll(html, /c-page-count__num[^>]*>\s*<strong>([^<]*)</g).map((text) => toNumber(text));
  if (numberList.length === 2 && html.includes('class="rstlist-notfound"')) {
    return { from: 0, to: 0, total: 0 };
  }
  const [from, to, total] = numberList;
  return { from, to, total };
};

const applyBudget = (query: URLSearchParams, budget: BudgetOption): string => {
  query.set("RdoCosTp", budget.meal === "dinner" ? "2" : "1");
  const lower = budget.min === undefined ? 0 : bandContaining(budget.min);
  const upper = budget.max === undefined ? 0 : bandContaining(Math.max(budget.max, 1000));
  if (lower) query.set("LstCos", String(lower));
  if (upper) query.set("LstCosT", String(upper));
  const lowerText = budget.min === undefined ? "" : `from JPY ${budget.min.toLocaleString("en-US")}`;
  const upperText = budget.max === undefined ? "" : `up to JPY ${budget.max.toLocaleString("en-US")}`;
  return `${budget.meal} ${[lowerText, upperText].filter(Boolean).join(" ")} (Tabelog bands ${lower || "-"}..${upper || "-"})`;
};

const applyVacancy = (query: URLSearchParams, vacancy: VacancyFilter): string => {
  const svd = toSvd(vacancy.date);
  const svt = toSvt(vacancy.time ?? "19:00");
  const people = vacancy.people && vacancy.people > 0 ? Math.floor(vacancy.people) : 2;
  query.set("svd", svd);
  query.set("svt", svt);
  query.set("svps", String(people));
  query.set("vac_net", "1");
  return `online-bookable on ${svd.slice(0, 4)}-${svd.slice(4, 6)}-${svd.slice(6, 8)} at ${svt.slice(0, 2)}:${svt.slice(2)} for ${people}`;
};

/**
 * near and openAt both need the restaurant page (coordinates live in its
 * JSON-LD, hours in its info table), so one fetch per card serves both.
 */
const enrich = async (
  itemList: SearchItem[],
  near: NearOption | undefined,
  at: WallClock | undefined,
): Promise<SearchItem[]> => {
  return mapLimit(itemList, 6, async (item) => {
    try {
      const page = await detailOf(await resolveRestaurant(item.url), "en");
      const hasGeo = page.latitude !== undefined && page.longitude !== undefined;
      return {
        ...item,
        distanceM:
          near && hasGeo
            ? distanceM(near.point, { latitude: page.latitude as number, longitude: page.longitude as number })
            : undefined,
        openStatus: at ? openStatusAt(page.hourList, at) : undefined,
        hourList: at ? page.hourList : undefined,
      };
    } catch {
      // A single page failing must not sink the whole search; the card stays with unknowns.
      return { ...item, openStatus: at ? "unknown" : undefined };
    }
  });
};

export const search = async (option: SearchOption): Promise<SearchResult> => {
  if (!option.area && !option.genre && !option.keyword && !option.near) {
    throw new Error("Give at least one of area, genre, keyword or near.");
  }
  const page = option.page && option.page > 1 ? Math.floor(option.page) : 1;

  const query = new URLSearchParams();
  query.set("SrtT", SORT_CODE_MAP[option.sort ?? "rating"]);

  let resolvedArea: string | undefined;
  if (option.area) {
    const area = await suggestArea(option.area);
    if (!area) throw new Error(`No Tabelog area matches "${option.area}". Try an English or Japanese place name.`);
    resolvedArea = `${area.name} (${area.datatype})`;
    query.set("pal", area.pal);
    query.set("LstPrf", area.lstPrf);
    query.set("LstAre", area.lstAre);
    query.set("station_id", area.stationId);
    query.set("area_datatype", area.datatype);
    query.set("area_id", area.id);
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

  const budgetNote = option.budget ? applyBudget(query, option.budget) : undefined;
  const vacancyNote = option.vacancy ? applyVacancy(query, option.vacancy) : undefined;

  const path = page > 1 ? `rstLst/${page}/` : "rstLst/";
  const url = `${localeUrl(option.locale, path)}?${query.toString()}`;
  const { body } = await fetchHtml(url);

  let itemList = splitBy(body, CARD_MARKER)
    .map(parseCard)
    .filter((item): item is SearchItem => item !== undefined);
  const count = parseCount(body);

  // A genuinely empty result still renders the counter (0). Neither cards nor a
  // counter means the markup moved, and that must not pass as "no results".
  if (!itemList.length && count.total === undefined) {
    throw new Error(`Could not find result cards or a result count at ${url}. Tabelog markup may have changed.`);
  }
  const pageCount = itemList.length;

  const at = option.openAt === undefined ? undefined : parseJapanTime(option.openAt);
  let nearNote: string | undefined;
  let openAtNote: string | undefined;
  if ((option.near || at) && itemList.length) {
    itemList = await enrich(itemList, option.near, at);
    if (option.near) {
      const { point, radiusM } = option.near;
      itemList = itemList
        .filter((item) => item.distanceM !== undefined && (radiusM === undefined || item.distanceM <= radiusM))
        .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
      nearNote = `sorted by distance from ${point.latitude},${point.longitude}${radiusM === undefined ? "" : ` within ${radiusM}m`} (this page only)`;
    }
    if (at) {
      const dropped = itemList.filter((item) => item.openStatus === "closed").length;
      itemList = itemList.filter((item) => item.openStatus !== "closed");
      openAtNote = `open at ${at.label}; ${dropped} closed dropped, "unknown" kept (no parsable hours)`;
    }
  }

  return {
    url,
    resolvedArea,
    resolvedGenre,
    budgetNote,
    vacancyNote,
    nearNote,
    openAtNote,
    ...count,
    page,
    pageCount,
    itemList,
  };
};
