import { attrOf, classText, parsePagination, splitBy } from "../html";
import { fetchHtml, type Locale } from "../http";
import { type PhotoMode, photoUrl, resolveRestaurant } from "../url";

export interface PhotoItem {
  /** 640px rendition. Swap 640x640 for 320x320 in the path for a thumbnail. */
  imageUrl: string;
  caption: string | undefined;
  /** "(by Restaurant)" or the reviewer's name, as printed. */
  by: string | undefined;
}

export interface PhotoResult {
  id: string;
  url: string;
  page: number;
  mode: PhotoMode;
  /** Last page Tabelog offers, when the pager is present. */
  lastPage: number | undefined;
  /** Set when the asked-for page does not exist; itemList is then empty. */
  note: string | undefined;
  itemList: PhotoItem[];
}

const ITEM_MARKER = '<li class="rstdtl-photo-list__item';

const parseItem = (chunk: string): PhotoItem | undefined => {
  const anchor = /<a class="js-imagebox-trigger rstdtl-photo-list__target"[^>]*>/.exec(chunk)?.[0];
  const imageUrl = anchor === undefined ? undefined : attrOf(anchor, "href");
  if (!imageUrl) return undefined;
  return {
    imageUrl,
    caption: classText(chunk, "rstdtl-photo-list__rvw-comment"),
    by: classText(chunk, "rstdtl-photo-list__rvwr-name")?.replace(/^[\uff08(]|[\uff09)]$/g, ""),
  };
};

export const photo = async (
  input: string,
  option: { page?: number; mode?: PhotoMode; locale: Locale },
): Promise<PhotoResult> => {
  const ref = await resolveRestaurant(input);
  const page = option.page && option.page > 1 ? Math.floor(option.page) : 1;
  const mode = option.mode ?? "all";
  const url = photoUrl(ref, option.locale, { page, mode });
  const { body } = await fetchHtml(url);
  return parsePhoto(body, { id: ref.id, url, page, mode });
};

export const parsePhoto = (
  body: string,
  at: { id: string; url: string; page: number; mode: PhotoMode },
): PhotoResult => {
  const itemList = splitBy(body, ITEM_MARKER)
    .map(parseItem)
    .filter((item): item is PhotoItem => item !== undefined);
  const end = pastEnd(body, at.page);
  return { ...at, ...end, itemList: end.note ? [] : itemList };
};

/** Tabelog serves page 1 again for a page past the end; that must not pass as page N. */
const pastEnd = (body: string, page: number): { lastPage: number | undefined; note: string | undefined } => {
  const { current, last } = parsePagination(body);
  if (current !== undefined && current !== page) {
    return { lastPage: last, note: `Page ${page} does not exist; the last page is ${last ?? current}.` };
  }
  return { lastPage: last, note: undefined };
};
