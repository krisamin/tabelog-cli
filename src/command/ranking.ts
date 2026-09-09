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

interface Candidate {
  name: string;
  partList: string[];
  /** Lower tries first. */
  order: number;
}

/**
 * Which ranking page best answers "Kobe"? The suggest index returns the city
 * (MajorMunicipal, no A-code), stations named Kobe (each inside some area2)
 * and towns. The city has no page of its own, but the area1 those stations
 * share (`A2801`) is the city's ranking, so it is derived from them and tried
 * before any single station's area2. Exact-name matches come before fuzzy ones.
 */
const candidateListOf = (areaList: AreaSuggest[]): Candidate[] => {
  const list: Candidate[] = [];
  for (const area of areaList) {
    const exact = area.exact ? 0 : 10;
    const partList = [area.pal, area.lstPrf, area.lstAre].filter((part, index) =>
      index === 0 ? part.length > 0 : AREA_CODE.test(part),
    );
    if (!partList.length) continue;
    if (area.datatype === "MajorMunicipal") {
      // The city itself: the deepest A-code any same-named exact candidate carries at area1 level.
      const sibling = areaList.find((other) => other.exact && AREA_CODE.test(other.lstPrf));
      if (sibling) list.push({ name: area.name, partList: [sibling.pal, sibling.lstPrf], order: exact + 1 });
      list.push({ name: area.name, partList, order: exact + 4 });
    } else if (area.datatype === "RailroadStation") {
      list.push({ name: area.name, partList, order: exact + 2 });
    } else {
      list.push({ name: area.name, partList, order: exact + (partList.length >= 3 ? 0 : 3) });
    }
  }
  const seen = new Set<string>();
  return list
    .sort((left, right) => left.order - right.order || right.partList.length - left.partList.length)
    .filter((candidate) => {
      const key = candidate.partList.join("/");
      return !seen.has(key) && seen.add(key);
    });
};

export const ranking = async (area: string, locale: Locale): Promise<RankingResult> => {
  const areaList = (await suggest(area)).filter((item): item is AreaSuggest => item.kind === "area");
  if (!areaList.length) throw new Error(`No Tabelog area matches "${area}". Try an English or Japanese place name.`);

  const candidateList = candidateListOf(areaList);
  if (!candidateList.length) throw new Error(`"${area}" has no Tabelog area codes, so it has no ranking page.`);

  for (const candidate of candidateList) {
    const url = localeUrl(locale, `${candidate.partList.join("/")}/rank/`);
    try {
      const { body } = await fetchHtml(url);
      const itemList = parseCardList(body);
      if (!itemList.length) continue;
      const title = pick(body, /<title>([^<]*)</) ?? "";
      const scope = /rankings? in (.+?)\s+TOP/i.exec(title)?.[1]?.trim() ?? candidate.name;
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
