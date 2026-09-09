export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6371008.8;

const toRadian = (degree: number): number => (degree * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export const distanceM = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = toRadian(b.latitude - a.latitude);
  const dLng = toRadian(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadian(a.latitude)) * Math.cos(toRadian(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
};

/** "35.6812,139.7671" or "35.6812 139.7671". */
export const parseGeoPoint = (input: string): GeoPoint => {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input);
  const latitude = Number(match?.[1]);
  const longitude = Number(match?.[2]);
  if (!match || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error(`Cannot read "${input}" as coordinates. Use "lat,lng".`);
  }
  return { latitude, longitude };
};

export const formatDistance = (metre: number): string => {
  return metre >= 1000 ? `${(metre / 1000).toFixed(1)}km` : `${metre}m`;
};

/** Run an async mapper with at most `limit` in flight, preserving order. */
export const mapLimit = async <T, R>(list: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> => {
  const resultList: R[] = new Array(list.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const index = next++;
      const item = list[index] as T;
      resultList[index] = await mapper(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return resultList;
};

/**
 * External geodata used only to turn coordinates into something Tabelog can
 * filter on. Tabelog's inbound site has no coordinate search, so the nearest
 * railway stations are looked up in OpenStreetMap (Overpass) and then resolved
 * through Tabelog's own suggest index.
 */

const GEO_USER_AGENT = "tabelog-cli (https://github.com/krisamin/tabelog-cli)";
// Public Overpass mirrors; the main one 504s under load, so they are tried in turn.
const OVERPASS_URL_LIST = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

export interface Station extends GeoPoint {
  name: string;
  nameEn: string | undefined;
  distanceM: number;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Railway stations within radiusM of the point, nearest first. */
export const stationListNear = async (point: GeoPoint, radiusM: number): Promise<Station[]> => {
  const around = `(around:${radiusM},${point.latitude},${point.longitude})`;
  const query = `[out:json][timeout:15];(node[railway=station]${around};way[railway=station]${around};);out center body;`;
  let res: Response | undefined;
  let lastError = "";
  for (const url of OVERPASS_URL_LIST) {
    try {
      const attempt = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": GEO_USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20000),
      });
      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastError = `HTTP ${attempt.status} from ${url}`;
    } catch (error) {
      lastError = `${url}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (!res)
    throw new Error(
      `Overpass unavailable (${lastError}); cannot find stations near ${point.latitude},${point.longitude}.`,
    );
  const body = (await res.json()) as { elements?: OverpassElement[] };
  const seen = new Set<string>();
  const list: Station[] = [];
  for (const element of body.elements ?? []) {
    const name = element.tags?.name;
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (!name || latitude === undefined || longitude === undefined || seen.has(name)) continue;
    seen.add(name);
    list.push({
      name,
      nameEn: element.tags?.["name:en"],
      latitude,
      longitude,
      distanceM: distanceM(point, { latitude, longitude }),
    });
  }
  return list.sort((a, b) => a.distanceM - b.distanceM);
};

export interface ReverseGeocode {
  /** Candidate place names from most local to broadest, e.g. ["Chuo Ward", "Kobe", "Hyogo Prefecture"]. */
  nameList: string[];
  displayName: string;
}

/** Address of a point, for the fallback when no station is close enough. */
export const reverseGeocode = async (point: GeoPoint): Promise<ReverseGeocode> => {
  const query = new URLSearchParams({
    lat: String(point.latitude),
    lon: String(point.longitude),
    format: "jsonv2",
    "accept-language": "en",
  });
  const res = await fetch(`${NOMINATIM_URL}?${query}`, { headers: { "user-agent": GEO_USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `Nominatim answered HTTP ${res.status}; cannot reverse-geocode ${point.latitude},${point.longitude}.`,
    );
  }
  const body = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  const address = body.address ?? {};
  const nameList = [
    "neighbourhood",
    "suburb",
    "quarter",
    "city_district",
    "town",
    "city",
    "county",
    "province",
    "state",
  ]
    .map((key) => address[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return { nameList: [...new Set(nameList)], displayName: body.display_name ?? "" };
};
