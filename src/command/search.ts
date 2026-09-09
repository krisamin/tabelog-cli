import { attrOf, classText, pick, pickAll, splitBy, toNumber } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
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

export interface SearchOption {
  /** Area name in English or Japanese: a station, town, ward, city or prefecture. Resolved via suggest. */
  area?: string;
  /** Genre name in English or Japanese. Resolved via suggest. */
  genre?: string;
  /** Free-text words the list page matches against names and menus (sw=). */
  keyword?: string;
  sort?: Sort;
  page?: number;
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
}

export interface SearchResult {
  url: string;
  resolvedArea: string | undefined;
  resolvedGenre: string | undefined;
  from: number | undefined;
  to: number | undefined;
  total: number | undefined;
  page: number;
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

export const search = async (option: SearchOption): Promise<SearchResult> => {
  if (!option.area && !option.genre && !option.keyword) {
    throw new Error("Give at least one of area, genre or keyword.");
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

  const path = page > 1 ? `rstLst/${page}/` : "rstLst/";
  const url = `${localeUrl(option.locale, path)}?${query.toString()}`;
  const { body } = await fetchHtml(url);

  const itemList = splitBy(body, CARD_MARKER)
    .map(parseCard)
    .filter((item): item is SearchItem => item !== undefined);
  const count = parseCount(body);

  // A genuinely empty result still renders the counter (0). Neither cards nor a
  // counter means the markup moved, and that must not pass as "no results".
  if (!itemList.length && count.total === undefined) {
    throw new Error(`Could not find result cards or a result count at ${url}. Tabelog markup may have changed.`);
  }

  return { url, resolvedArea, resolvedGenre, ...count, page, itemList };
};
