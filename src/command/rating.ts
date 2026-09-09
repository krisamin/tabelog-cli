import { classText, splitBy, textOf, toNumber } from "../html";
import { fetchHtml, type Locale } from "../http";
import { ratingUrl, resolveRestaurant } from "../url";

/**
 * /dtlratings/ carries what the score alone hides: the per-aspect averages
 * (taste, service, atmosphere, drinks, cost performance), how many reviewers
 * gave each score band, and how much recent reviewers actually spent.
 */

export interface ScoreRow {
  label: string;
  score: number | undefined;
}

export interface CountRow {
  band: string;
  count: number;
}

export interface SpendGroup {
  /** "Average dinner price" or "Average lunch price" as the page labels it. */
  label: string;
  typical: string | undefined;
  bandList: CountRow[];
}

export interface RatingResult {
  id: string;
  url: string;
  averageList: ScoreRow[];
  distributionList: CountRow[];
  spendList: SpendGroup[];
}

const parseAverageList = (html: string): ScoreRow[] => {
  const table = /<dl class="ratings-contents__table">([\s\S]*?)<\/dl>/.exec(html)?.[1] ?? "";
  return [...table.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) => ({
    label: textOf(match[1] ?? ""),
    score: toNumber(textOf(match[2] ?? "")),
  }));
};

const parseCountList = (html: string, rateClass: string): CountRow[] => {
  return splitBy(html, '<li class="ratings-contents__item')
    .map((chunk) => ({
      band: classText(chunk, rateClass) ?? "",
      count: toNumber(classText(chunk, "ratings-contents__item-num-strong")) ?? 0,
    }))
    .filter((row) => row.band.length > 0);
};

export const rating = async (input: string, locale: Locale): Promise<RatingResult> => {
  const ref = await resolveRestaurant(input);
  const url = ratingUrl(ref, locale);
  const { body } = await fetchHtml(url);
  return parseRating(body, { id: ref.id, url });
};

export const parseRating = (body: string, at: { id: string; url: string }): RatingResult => {
  const { id, url } = at;

  const spendStart = body.indexOf('id="price-range"');
  const scoreRegion = spendStart < 0 ? body : body.slice(0, spendStart);
  const spendRegion = spendStart < 0 ? "" : body.slice(spendStart);

  const averageList = parseAverageList(scoreRegion);
  const distributionList = parseCountList(scoreRegion, "ratings-contents__item-score");
  if (!averageList.length && !distributionList.length) {
    throw new Error(`No rating table at ${url}. Tabelog markup may have changed.`);
  }

  // Dinner sits in ratings-contents__left and lunch in __right, each with its
  // own typical price line and spending histogram.
  const spendList = spendRegion
    .split(/<div class="ratings-contents__(?:left|right)">/)
    .slice(1)
    .map((chunk) => ({
      label: classText(chunk, "ratings-contents__budge-subtxt") ?? "Spending",
      typical: classText(chunk, "ratings-contents__budge-price"),
      bandList: parseCountList(chunk, "ratings-contents__item-rate--budget"),
    }))
    .filter((group) => group.bandList.length > 0);

  return { id, url, averageList, distributionList, spendList };
};
