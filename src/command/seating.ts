import { attrOf, classText, splitBy, textOf } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { resolveRestaurant } from "../url";

/**
 * The seat list from /table/: what kinds of seating exist (counter, tatami,
 * private room, terrace) with the restaurant's own caption and a photo for
 * each. This is where "private room for 6" actually lives; the info table only
 * says available or not.
 */

export interface SeatItem {
  caption: string | undefined;
  imageUrl: string | undefined;
}

export interface SeatSection {
  /** "Counter seating", "Private room", "Tatami room". */
  title: string | undefined;
  itemList: SeatItem[];
}

export interface SeatingResult {
  id: string;
  url: string;
  sectionList: SeatSection[];
}

const SECTION_MARKER = '<div class="rstdtl-table-lst__contents">';
const ITEM_MARKER = '<div class="rstdtl-table-lst__seat-item">';

const parseSection = (chunk: string): SeatSection => ({
  title: classText(chunk, "c-heading3__title"),
  itemList: splitBy(chunk, ITEM_MARKER).map((item) => ({
    caption: classText(item, "rstdtl-table-lst__caption"),
    imageUrl: attrOf(/<a class="js-imagebox-trigger rstdtl-table-lst__img-target"[^>]*>/.exec(item)?.[0] ?? "", "href"),
  })),
});

export const seating = async (input: string, locale: Locale): Promise<SeatingResult> => {
  const ref = await resolveRestaurant(input);
  const url = localeUrl(locale, `${ref.path}/table/`);
  const { body } = await fetchHtml(url);
  return parseSeating(body, { id: ref.id, url });
};

export const parseSeating = (body: string, at: { id: string; url: string }): SeatingResult => {
  const { url } = at;
  const region = body.slice(body.indexOf('id="rstdtl-table"'));
  const sectionList = splitBy(region, SECTION_MARKER)
    .map(parseSection)
    .filter((section) => section.itemList.some((item) => item.caption || item.imageUrl));
  // The page prints a "not registered yet" notice instead of sections; that is
  // a real answer, so it is returned as an empty list rather than an error.
  if (!sectionList.length && !region.includes("contents-nodata")) {
    const heading = textOf(region.slice(0, 400));
    throw new Error(`No seat sections and no "not registered" notice at ${url} (page said: ${heading.slice(0, 80)}).`);
  }
  return { ...at, sectionList };
};
