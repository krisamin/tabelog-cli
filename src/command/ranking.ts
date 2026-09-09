import { pick } from "../html";
import { fetchHtml, type Locale, localeUrl } from "../http";
import { parseCardList, type SearchItem } from "./card";
import { type AreaSuggest, suggest } from "./suggest";

/**
 * Tabelog's own "popular restaurants" TOP 20 for a place, which is not the same
 * as the score-ordered list: it reflects what people view and book. One page,
 * no genre filter.
 *
 * The path is built only from A-codes (`/hokkaido/A0101/A010103/rank/`). The
 * city ids the suggest index returns for a MajorMunicipal (`C1100`) are not
 * path segments and 404, so a place that only resolves to one falls back to a
 * broader or nearby area. The scope actually served is read back from the
 * page's own title rather than assumed.
 */

export interface RankingResult {
  url: string;
  /** The place Tabelog says the ranking covers, taken from the page title. */
  resolvedArea: string;
  /** Set when the page covers something wider or narrower than what was asked for. */
  note: string | undefined;
  itemList: SearchItem[];
}

const AREA_CODE = /^A\d+$/;

const pathOf = (area: AreaSuggest): string[] => {
  return [area.pal, area.lstPrf, area.lstAre].filter((part, index) =>
    index === 0 ? part.length > 0 : AREA_CODE.test(part),
  );
};

export const ranking = async (area: string, locale: Locale): Promise<RankingResult> => {
  const areaList = (await suggest(area)).filter((item): item is AreaSuggest => item.kind === "area");
  if (!areaList.length) throw new Error(`No Tabelog area matches "${area}". Try an English or Japanese place name.`);

  // Deepest path first: an area2 ranking is more useful than its prefecture's.
  const candidateList = areaList
    .map((item) => ({ item, partList: pathOf(item) }))
    .filter((candidate) => candidate.partList.length > 0)
    .sort((left, right) => right.partList.length - left.partList.length);
  if (!candidateList.length) throw new Error(`"${area}" has no Tabelog area codes, so it has no ranking page.`);

  for (const candidate of candidateList) {
    const url = localeUrl(locale, `${candidate.partList.join("/")}/rank/`);
    try {
      const { body } = await fetchHtml(url);
      const itemList = parseCardList(body);
      if (!itemList.length) continue;
      const title = pick(body, /<title>([^<]*)</) ?? "";
      const scope = /rankings? in (.+?)\s+TOP/i.exec(title)?.[1]?.trim() ?? candidate.item.name;
      const asked = area.trim().toLowerCase();
      const note = scope.toLowerCase().includes(asked)
        ? undefined
        : `Tabelog has no ranking page for "${area}" itself; this covers ${scope}.`;
      return { url, resolvedArea: scope, note, itemList };
    } catch {
      // 404 for this shape of area; try the next candidate.
    }
  }
  throw new Error(`No Tabelog ranking page exists for "${area}".`);
};
