import type { HourGroup, OpenStatus } from "../hour";
import { attrOf, classText, pick, pickAll, splitBy, toNumber } from "../html";

/**
 * The restaurant card (`list-rst__*`) that the search list, the ranking page
 * and any other list view all render. Shared so a new list page needs no new
 * parser.
 */

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
  privateRoom: string | undefined;
  parking: string | undefined;
}

const CARD_MARKER = '<div class="list-rst js-bookmark';

const priceOf = (card: string, time: "dinner" | "lunch"): string | undefined => {
  return pick(card, new RegExp(`c-rating-v3__time--${time}"[^>]*></i><span class="c-rating-v3__val">([^<]*)<`));
};

/**
 * The ranking page prints the name in an `<h3 ...-rank20>` and omits the price
 * row; the search list carries `data-detail-url`. Both have `data-rst-id` and a
 * `list-rst__rst-name-target` anchor, so those are the anchor points here.
 */
const parseCard = (card: string): SearchItem | undefined => {
  const id = attrOf(card, "data-rst-id");
  const anchor = /<a class="list-rst__rst-name-target"[^>]*>/.exec(card)?.[0] ?? "";
  const url = attrOf(card, "data-detail-url") ?? attrOf(anchor, "href");
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
    privateRoom: undefined,
    parking: undefined,
  };
};

export const parseCardList = (html: string): SearchItem[] => {
  return splitBy(html, CARD_MARKER)
    .map(parseCard)
    .filter((item): item is SearchItem => item !== undefined);
};

/** "Sannomiya Sta. 450m / Ramen" into the station label and metres, when the card has them. */
export const stationDistanceOf = (item: SearchItem): { station: string; metre: number } | undefined => {
  const match = /^(.*?)\s+(\d[\d,]*)\s*m\s*\//.exec(item.areaGenre ?? "");
  const metre = toNumber(match?.[2]);
  return match?.[1] && metre !== undefined ? { station: match[1], metre } : undefined;
};

/**
 * "1 - 20 / 146" normally; an empty result renders "0 results / 0 results" with
 * only two numbers and a rstlist-notfound block instead of cards.
 */
export const parseCount = (
  html: string,
): { from: number | undefined; to: number | undefined; total: number | undefined } => {
  const numberList = pickAll(html, /c-page-count__num[^>]*>\s*<strong>([^<]*)</g).map((text) => toNumber(text));
  if (numberList.length === 2 && html.includes('class="rstlist-notfound"')) {
    return { from: 0, to: 0, total: 0 };
  }
  const [from, to, total] = numberList;
  return { from, to, total };
};
