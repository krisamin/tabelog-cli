import { distanceM, type GeoPoint, reverseGeocode, type Station, stationListNear } from "../geo";
import { type AreaSuggest, stationCandidateList, suggest } from "./suggest";

/**
 * Coordinates to a Tabelog area. Tabelog cannot search by coordinates, so the
 * nearest railway stations come from OpenStreetMap and each is looked up in
 * Tabelog's suggest index until one resolves to a RailroadStation filter. If no
 * station is near, the address (ward, city) is tried the same way.
 */

export interface LocateCandidate {
  area: AreaSuggest;
  /** The OSM station that resolved, when the area came from a station. */
  station: Station | undefined;
  distanceM: number | undefined;
}

export interface LocateResult {
  point: GeoPoint;
  /** Stations OSM knows within the search radius, nearest first, whether or not Tabelog resolved them. */
  stationList: Station[];
  address: string | undefined;
  candidateList: LocateCandidate[];
}

const STATION_RADIUS_M = 2000;
const STATION_TRY_COUNT = 6;

/** How far Tabelog's station point may sit from OSM's for the two to count as the same station. */
const SAME_STATION_M = 1200;

const stationQueryList = (station: Station): string[] => {
  const list = [station.name.replace(/\u99c5$/, "")];
  // "Kobe-Sannomiya" and "Kobe Sannomiya" both occur; Tabelog's index matches the spaced form.
  if (station.nameEn) list.push(station.nameEn.replace(/-/g, " ").replace(/\s+Station$/i, ""));
  return [...new Set(list)];
};

/**
 * Name lookups are fuzzy ("Bus Center-Mae" once came back as Maebashi in
 * Gunma), so a station only counts when the Japanese site's suggest places a
 * station of that id within SAME_STATION_M of the OSM point.
 */
const stationSuggest = async (station: Station): Promise<AreaSuggest | undefined> => {
  const verifiedIdSet = new Set<string>();
  for (const candidate of await stationCandidateList(station.name.replace(/\u99c5$/, ""))) {
    if (distanceM(station, candidate) <= SAME_STATION_M) verifiedIdSet.add(candidate.id);
  }
  if (!verifiedIdSet.size) return undefined;
  for (const query of stationQueryList(station)) {
    const hit = (await suggest(query)).find(
      (item): item is AreaSuggest =>
        item.kind === "area" && item.datatype === "RailroadStation" && verifiedIdSet.has(item.id),
    );
    if (hit) return hit;
  }
  return undefined;
};

export const locate = async (point: GeoPoint): Promise<LocateResult> => {
  const stationList = await stationListNear(point, STATION_RADIUS_M);
  const candidateList: LocateCandidate[] = [];
  const seenAreaId = new Set<string>();

  for (const station of stationList.slice(0, STATION_TRY_COUNT)) {
    const area = await stationSuggest(station);
    if (!area || seenAreaId.has(area.id)) continue;
    seenAreaId.add(area.id);
    candidateList.push({ area, station, distanceM: station.distanceM });
  }

  let address: string | undefined;
  if (!candidateList.length) {
    const geocode = await reverseGeocode(point);
    address = geocode.displayName || undefined;
    for (const name of geocode.nameList) {
      const list = (await suggest(name)).filter((item): item is AreaSuggest => item.kind === "area");
      const hit = list.find((item) => item.exact) ?? list[0];
      if (hit && !seenAreaId.has(hit.id)) {
        seenAreaId.add(hit.id);
        candidateList.push({ area: hit, station: undefined, distanceM: undefined });
        if (candidateList.length >= 2) break;
      }
    }
  }

  if (!candidateList.length) {
    throw new Error(
      `Nothing near ${point.latitude},${point.longitude} resolves to a Tabelog area (no station within ${STATION_RADIUS_M}m and no address match).`,
    );
  }
  return { point, stationList, address, candidateList };
};
