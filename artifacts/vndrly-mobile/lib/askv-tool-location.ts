import * as Location from "expo-location";
const gpsWrites = new Set(["set_ticket_lifecycle", "close_ticket_for_review", "prepare_visitor_check_in", "confirm_visitor_check_in", "confirm_visitor_check_out"]);
const locationQueries = new Set(["lookup_map_origin", "query_ticket_route_eta", "query_ticket_mileage_audit", "estimate_driving_route"]);
export type AskVCoordinates = { latitude: number; longitude: number };

/** GPS comes from the device, never from model-invented coordinates. */
export async function withAskVToolLocation(name: string, args: Record<string, unknown>, confirmedCoordinates?: AskVCoordinates): Promise<Record<string, unknown>> {
  const write = gpsWrites.has(name);
  if (!write && (!locationQueries.has(name) || args.origin === "shop")) return args;
  if (write && confirmedCoordinates) return { ...args, ...confirmedCoordinates };
  const previous = await Location.getForegroundPermissionsAsync();
  const permission = previous.status === "granted" ? previous : await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Location permission is needed for this action. Nothing was changed.");
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("The device could not determine a valid location. Nothing was changed.");
  }
  if (write) return { ...args, latitude, longitude };
  return { ...args, currentLatitude: latitude, currentLongitude: longitude };
}
