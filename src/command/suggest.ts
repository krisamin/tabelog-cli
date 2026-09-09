import { fetchJson, localeUrl } from "../http";

/**
 * The keyword suggest endpoint is what the /en/ search box calls as you type.
 * It resolves free text into typed entities: areas (prefecture, area, station)
 * that carry the ids the list page filters on, genres that carry the genre
 * code, and restaurants that carry a direct URL. It indexes English and
 * Japanese names only; Korean input returns an empty list.
 */

export const AREA_DATATYPE_LIST = [
  "Prefecture",
  "Area1",
  "Area2",
  "RailroadStation",
  "FullArea1",
  "FullArea2",
  "AddressMaster",
  "MajorMunicipal",
] as const;
export const GENRE_DATATYPE_LIST = ["Genre0", "Genre1", "Genre2", "Genre3"] as const;
export const RESTAURANT_DATATYPE = "AreaRestaurant";

export type AreaDatatype = (typeof AREA_DATATYPE_LIST)[number];
export type GenreDatatype = (typeof GENRE_DATATYPE_LIST)[number];

interface RawSuggest {
  name?: string;
  id_in_datatype?: number | string;
  datatype?: string;
  exact_match?: boolean;
  site_name?: string;
  sub_name?: string;
  url?: string;
  pal?: string;
  LstPrf?: string;
  LstAre?: string;
  station_id?: string;
}

export interface AreaSuggest {
  kind: "area";
  name: string;
  datatype: AreaDatatype;
  id: string;
  exact: boolean;
  pal: string;
  lstPrf: string;
  lstAre: string;
  stationId: string;
}

export interface GenreSuggest {
  kind: "genre";
  name: string;
  datatype: GenreDatatype;
  id: string;
  exact: boolean;
  /** The genre code the list page filters on (genre_name=), e.g. MC01. */
  code: string;
}

export interface RestaurantSuggest {
  kind: "restaurant";
  name: string;
  id: string;
  /** "[Hyogo] Sannomiya Sta. / Ramen" */
  subName: string;
  url: string;
}

export type Suggest = AreaSuggest | GenreSuggest | RestaurantSuggest;

const isAreaDatatype = (value: string): value is AreaDatatype => {
  return (AREA_DATATYPE_LIST as readonly string[]).includes(value);
};

const isGenreDatatype = (value: string): value is GenreDatatype => {
  return (GENRE_DATATYPE_LIST as readonly string[]).includes(value);
};

const normalize = (raw: RawSuggest): Suggest | undefined => {
  const name = raw.name?.trim() ?? "";
  const datatype = raw.datatype ?? "";
  const id = raw.id_in_datatype === undefined ? "" : String(raw.id_in_datatype);
  if (!name || !id) return undefined;

  if (isAreaDatatype(datatype)) {
    return {
      kind: "area",
      name,
      datatype,
      id,
      exact: raw.exact_match === true,
      pal: raw.pal ?? "",
      lstPrf: raw.LstPrf ?? "",
      lstAre: raw.LstAre ?? "",
      stationId: raw.station_id ?? "",
    };
  }
  if (isGenreDatatype(datatype)) {
    if (!raw.site_name) return undefined;
    return { kind: "genre", name, datatype, id, exact: raw.exact_match === true, code: raw.site_name };
  }
  if (datatype === RESTAURANT_DATATYPE && raw.url) {
    return { kind: "restaurant", name, id, subName: raw.sub_name?.trim() ?? "", url: raw.url };
  }
  return undefined;
};

export const suggest = async (keyword: string): Promise<Suggest[]> => {
  const trimmed = keyword.trim();
  if (!trimmed) throw new Error("keyword is required.");
  const url = `${localeUrl("en", "suggest/keyword_suggest")}?${new URLSearchParams({ keyword: trimmed })}`;
  const raw = await fetchJson<RawSuggest[]>(url);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalize).filter((item): item is Suggest => item !== undefined);
};

/** Exact match first, then the first item of the kind; undefined when the kind is absent. */
export const suggestArea = async (keyword: string): Promise<AreaSuggest | undefined> => {
  const list = (await suggest(keyword)).filter((item): item is AreaSuggest => item.kind === "area");
  return list.find((item) => item.exact) ?? list[0];
};

export const suggestGenre = async (keyword: string): Promise<GenreSuggest | undefined> => {
  const list = (await suggest(keyword)).filter((item): item is GenreSuggest => item.kind === "genre");
  return list.find((item) => item.exact) ?? list[0];
};
