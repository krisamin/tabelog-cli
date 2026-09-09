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

const parseCard = (card: string): ReviewItem => {
  const reviewerAnchor = /<a class="rvw-item__rvwr-name"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(card);
  const reviewerName = reviewerAnchor?.[2]?.replace(/<span class="rstdtl-rvw-country[\s\S]*$/, "");
  const ratingBlock = /rvw-item__ratings-total[\s\S]*?<\/p>/.exec(card)?.[0] ?? "";
  const timeMatch = /c-rating-v3__time--(dinner|lunch)/.exec(ratingBlock);

  return {
    reviewer: reviewerName === undefined ? undefined : textOf(reviewerName) || undefined,
    reviewerUrl: reviewerAnchor?.[1],
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
