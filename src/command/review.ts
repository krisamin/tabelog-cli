import { attrOf, classText, pick, splitBy, textOf, toNumber } from "../html";
import { fetchHtml, type Locale } from "../http";
import { resolveRestaurant, reviewListUrl } from "../url";

export const USE_TYPE_LIST = ["all", "dinner", "lunch"] as const;
export type UseType = (typeof USE_TYPE_LIST)[number];

const USE_TYPE_CODE_MAP: Record<UseType, 0 | 1 | 2> = { all: 0, dinner: 1, lunch: 2 };

export const isUseType = (value: unknown): value is UseType => {
  return typeof value === "string" && (USE_TYPE_LIST as readonly string[]).includes(value);
};

export interface ReviewOption {
  page?: number;
  useType?: UseType;
  /** Newest visit first instead of Tabelog's default (recommended) order. */
  byVisit?: boolean;
  locale: Locale;
}

export interface ReviewItem {
  reviewer: string | undefined;
  reviewerUrl: string | undefined;
  reviewerPostCount: number | undefined;
  /** "dinner" or "lunch" as shown by the rating icon. */
  time: string | undefined;
  rating: number | undefined;
  spend: string | undefined;
  visited: string | undefined;
  visitCount: string | undefined;
  title: string | undefined;
  /** Only the excerpt the list page renders; the full text is at url. */
  excerpt: string | undefined;
  url: string | undefined;
}

export interface ReviewResult {
  url: string;
  page: number;
  itemList: ReviewItem[];
}

const CARD_MARKER = '<div class="rvw-item js-rvw-item-clickable-area">';

/**
 * The reviewer link's attribute order differs between the list and the
 * single-review page, and on the single page the name is wrapped in a level
 * badge span. Only the trailing country badge is stripped; whatever remains is
 * the name.
 */
const reviewerAnchorOf = (html: string): { href: string | undefined; name: string | undefined } | undefined => {
  const match = /<a([^>]*\bclass="rvw-item__rvwr-name"[^>]*)>([\s\S]*?)<\/a>/.exec(html);
  if (!match) return undefined;
  const name = textOf((match[2] ?? "").replace(/<span class="rstdtl-rvw-country[\s\S]*$/, ""));
  return { href: attrOf(match[1] ?? "", "href"), name: name || undefined };
};

const parseCard = (card: string): ReviewItem => {
  const reviewerAnchor = reviewerAnchorOf(card);
  const ratingBlock = /rvw-item__ratings-total[\s\S]*?<\/p>/.exec(card)?.[0] ?? "";
  const timeMatch = /c-rating-v3__time--(dinner|lunch)/.exec(ratingBlock);

  return {
    reviewer: reviewerAnchor?.name,
    reviewerUrl: reviewerAnchor?.href,
    reviewerPostCount: toNumber(pick(card, /rvw-item__rvwr-num">[^<]*?(\d[\d,]*)/)),
    time: timeMatch?.[1],
    rating: toNumber(classText(ratingBlock, "c-rating-v3__val")),
    spend: classText(card, "rvw-item__payment-amount-delimiter")?.replace(/\uff5e/g, "~"),
    visited: pick(card, /rvw-item__date-inner">\s*<span>([^<]*)</),
    visitCount: classText(card, "rvw-item__count-num"),
    title: pick(card, /rvw-item__title-target[^>]*>([\s\S]*?)<\/a>/),
    excerpt: pick(card, /rvw-item__rvw-comment[^"]*">\s*<p>([\s\S]*?)<\/p>/),
    url: attrOf(card, "data-detail-url"),
  };
};

export const review = async (input: string, option: ReviewOption): Promise<ReviewResult> => {
  const ref = await resolveRestaurant(input);
  const page = option.page && option.page > 1 ? Math.floor(option.page) : 1;
  const url = reviewListUrl(ref, option.locale, {
    page,
    useType: USE_TYPE_CODE_MAP[option.useType ?? "all"],
    sortByVisit: option.byVisit === true,
  });
  const { body } = await fetchHtml(url);
  return { url, page, itemList: splitBy(body, CARD_MARKER).map(parseCard) };
};

/**
 * One reviewer's page for a restaurant (/dtlrvwlst/B{bookmark}/): every visit
 * they logged, each with the full text the list page only excerpts.
 */

export interface ReviewVisit {
  time: string | undefined;
  rating: number | undefined;
  spend: string | undefined;
  visited: string | undefined;
  visitCount: string | undefined;
  title: string | undefined;
  text: string | undefined;
  imageUrlList: string[];
}

export interface ReviewReadResult {
  url: string;
  reviewer: string | undefined;
  reviewerUrl: string | undefined;
  visitList: ReviewVisit[];
}

const VISIT_MARKER = '<div class="rvw-item__review-contents ';

export const reviewRead = async (input: string, locale: Locale): Promise<ReviewReadResult> => {
  const match = /\/(?:[a-z]{2}\/)?([a-z]+\/A\d{4}\/A\d{6}\/\d+)\/dtlrvwlst\/(B\d+)\//.exec(input.trim());
  if (!match) throw new Error(`Not a Tabelog review URL (expected .../dtlrvwlst/B123456/): ${input}`);
  const url = `https://tabelog.com/${locale}/${match[1]}/dtlrvwlst/${match[2]}/`;
  const { body } = await fetchHtml(url);

  const reviewerAnchor = reviewerAnchorOf(body);
  const visitList = splitBy(body, VISIT_MARKER).map((chunk): ReviewVisit => {
    const ratingBlock = /rvw-item__single-ratings-total[\s\S]*?<\/p>/.exec(chunk)?.[0] ?? "";
    return {
      time: /c-rating-v3__time--(dinner|lunch)/.exec(ratingBlock)?.[1],
      rating: toNumber(classText(ratingBlock, "c-rating-v3__val")),
      spend: classText(chunk, "rvw-item__payment-amount-delimiter")?.replace(/\uff5e/g, "~"),
      visited: pick(chunk, /rvw-item__date-inner">\s*<span>([^<]*)</),
      visitCount: classText(chunk, "rvw-item__count-num"),
      title: pick(chunk, /rvw-item__title[^>]*>\s*<strong>([\s\S]*?)<\/strong>/),
      text: pick(chunk, /rvw-item__rvw-comment[^"]*">\s*<p>([\s\S]*?)<\/p>/),
      imageUrlList: [...chunk.matchAll(/class="js-imagebox-trigger"[^>]*href="([^"]*)"/g)].map((item) => item[1] ?? ""),
    };
  });
  if (!visitList.length) throw new Error(`No review body at ${url}. Tabelog markup may have changed.`);

  return {
    url,
    reviewer: reviewerAnchor?.name,
    reviewerUrl: reviewerAnchor?.href,
    visitList,
  };
};
