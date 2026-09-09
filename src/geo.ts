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
