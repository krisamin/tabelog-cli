import { attrOf, classText, pick, splitBy } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { resolveRestaurant } from "../url";

/**
 * Set menus ("courses") a restaurant sells, from /party/. These are what the
 * reservation flow books against, so the plan id here is the same one the
 * booking form takes. Not every restaurant registers courses; an empty page
 * says so rather than failing.
 */

export interface CourseItem {
  planId: string | undefined;
  title: string;
  /** "9,800" as printed, plus whether tax is included, in priceNote. */
  price: string | undefined;
  priceNote: string | undefined;
  description: string | undefined;
  /** "Most popular" and similar badges the restaurant sets. */
  labelList: string[];
  /** Course conditions: number of dishes, time limit, minimum party. */
  ruleList: string[];
  url: string | undefined;
  imageUrl: string | undefined;
}

export interface CourseResult {
  id: string;
  url: string;
  itemList: CourseItem[];
}

const ITEM_MARKER = '<div class="rstdtl-course-list js-rstdtl-course-list">';

const parseItem = (chunk: string): CourseItem | undefined => {
  const title = classText(chunk, "rstdtl-course-list__course-title-text");
  if (!title) return undefined;
  const button = /<span class="[^"]*js-show-yoyaku-modal-trigger-course"[^>]*>/.exec(chunk)?.[0] ?? "";
  const imageAnchor = /<a class="rstdtl-course-list__img-target"[^>]*>/.exec(chunk)?.[0] ?? "";
  const ruleBlock = /<dl class="rstdtl-course-list__course-rule">([\s\S]*?)<\/dl>/.exec(chunk)?.[1] ?? "";
  const ruleList: string[] = [];
  for (const match of ruleBlock.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const label = pick(match[0], /<dt[^>]*>([\s\S]*?)<\/dt>/);
    const value = pick(match[0], /<dd[^>]*>([\s\S]*?)<\/dd>/);
    if (label || value) ruleList.push([label, value].filter(Boolean).join(": "));
  }

  return {
    planId: attrOf(button, "data-plan-id"),
    title,
    price: pick(chunk, /rstdtl-course-list__price-num">[^<]*<em>([^<]*)<\/em>/) ?? attrOf(button, "data-real-price"),
    priceNote: classText(chunk, "rstdtl-course-list__price-num-tax"),
    description: classText(chunk, "rstdtl-course-list__desc"),
    labelList: [...chunk.matchAll(/rstdtl-course-list__feature-label[^"]*"><span>([^<]*)<\/span>/g)].map(
      (match) => match[1] ?? "",
    ),
    ruleList,
    url: attrOf(/<a class="rstdtl-course-list__target"[^>]*>/.exec(chunk)?.[0] ?? "", "href"),
    imageUrl: attrOf(imageAnchor, "href"),
  };
};

export const course = async (input: string, locale: Locale): Promise<CourseResult> => {
  const ref = await resolveRestaurant(input);
  const url = localeUrl(locale, `${ref.path}/party/`);
  const { body } = await fetchHtml(url);
  return parseCourse(body, { id: ref.id, url });
};

export const parseCourse = (body: string, at: { id: string; url: string }): CourseResult => {
  const itemList = splitBy(body, ITEM_MARKER)
    .map(parseItem)
    .filter((item): item is CourseItem => item !== undefined);
  return { ...at, itemList };
};
