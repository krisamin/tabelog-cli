import { attrOf, classText, pick, splitBy } from "../html";
import { fetchHtml, type Locale } from "../http";
import { type MenuKind, menuUrl, resolveRestaurant } from "../url";

/**
 * Menu pages are owner-maintained and often empty; when a restaurant has
 * posted nothing the page falls back to the info table with no
 * rstdtl-menu-lst block at all, which is a legitimate "no menu", not a parse
 * failure.
 */

export interface MenuItem {
  name: string;
  price: string | undefined;
  note: string | undefined;
  imageUrl: string | undefined;
}

export interface MenuSection {
  title: string | undefined;
  itemList: MenuItem[];
}

export interface MenuResult {
  id: string;
  kind: MenuKind;
  url: string;
  lastUpdated: string | undefined;
  sectionList: MenuSection[];
}

const SECTION_MARKER = '<div class="rstdtl-menu-lst">';
const ITEM_MARKER = '<div class="rstdtl-menu-lst__contents">';

const parseItem = (chunk: string): MenuItem | undefined => {
  const name = classText(chunk, "rstdtl-menu-lst__menu-title");
  if (!name) return undefined;
  const imageAnchor = /<a class="js-imagebox-trigger rstdtl-menu-lst__target"[^>]*>/.exec(chunk)?.[0];
  return {
    name,
    price: classText(chunk, "rstdtl-menu-lst__price"),
    note: pick(chunk, /rstdtl-menu-lst__ex"[^>]*>([\s\S]*?)<\/p>/),
    imageUrl: imageAnchor === undefined ? undefined : attrOf(imageAnchor, "href"),
  };
};

const parseSection = (chunk: string): MenuSection => ({
  title: classText(chunk, "rstdtl-menu-lst__title"),
  itemList: splitBy(chunk, ITEM_MARKER)
    .map(parseItem)
    .filter((item): item is MenuItem => item !== undefined),
});

export const menu = async (input: string, kind: MenuKind, locale: Locale): Promise<MenuResult> => {
  const ref = await resolveRestaurant(input);
  const url = menuUrl(ref, locale, kind);
  const { body } = await fetchHtml(url);

  const menuStart = body.indexOf("rstdtl-menu-heading");
  const region = menuStart < 0 ? "" : body.slice(menuStart);
  const sectionList = splitBy(region, SECTION_MARKER)
    .map(parseSection)
    .filter((section) => section.itemList.length > 0);

  return {
    id: ref.id,
    kind,
    url,
    lastUpdated:
      pick(body, /Last updated\s*:\s*([^<]*)</i) ??
      pick(body, /rstdtl-menu-update[^>]*>\s*<span>([^<]*)</) ??
      undefined,
    sectionList,
  };
};

export const menuItemCount = (result: MenuResult): number => {
  return result.sectionList.reduce((sum, section) => sum + section.itemList.length, 0);
};
