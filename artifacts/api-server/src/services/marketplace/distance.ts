export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Named latitude/longitude fields prevent tuple-order ambiguity. (0,0) is a missing-data sentinel in VNDRLY. */
export function validCoordinates(
  value: Coordinates | null | undefined,
): value is Coordinates {
  return (
    !!value &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180 &&
    !(value.latitude === 0 && value.longitude === 0)
  );
}

/** Haversine great-circle distance, using IUGG mean Earth radius 6371.0088 km / 1.609344 = 3958.7613 miles. */
export function distanceMiles(a: Coordinates, b: Coordinates): number {
  if (!validCoordinates(a) || !validCoordinates(b))
    throw new Error("Invalid latitude/longitude coordinates");
  const radians = Math.PI / 180;
  const haversine =
    Math.sin(((b.latitude - a.latitude) * radians) / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;
  return (
    3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
  );
}
