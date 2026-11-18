const LOCATION_TOOLS = new Set(['prepare_visitor_check_in', 'confirm_visitor_check_in', 'prepare_visitor_check_out', 'confirm_visitor_check_out', 'set_ticket_lifecycle', 'close_ticket_for_review']);
const OPTIONAL_GATE_LOCATION = new Set(['prepare_visitor_check_in', 'confirm_visitor_check_in', 'prepare_visitor_check_out', 'confirm_visitor_check_out']);
const LOCATION_QUERIES = new Set(['lookup_map_origin', 'query_ticket_route_eta', 'query_ticket_mileage_audit', 'estimate_driving_route']);

/** GPS is device evidence, never a coordinate guessed by the model. Keep it fixed for confirmation. */
export async function addAskVToolLocation(name: string, input: Record<string, unknown>, pending?: unknown): Promise<Record<string, unknown>> {
  const locationQuery = LOCATION_QUERIES.has(name) && input.origin !== 'shop';
  if (!LOCATION_TOOLS.has(name) && !locationQuery) return input;
  const previous = pending && typeof pending === 'object' ? pending as Record<string, unknown> : null;
  if (previous && typeof previous.latitude === 'number' && typeof previous.longitude === 'number') {
    return { ...input, latitude: previous.latitude, longitude: previous.longitude };
  }
  const { latitude: _latitude, longitude: _longitude, currentLatitude: _currentLatitude, currentLongitude: _currentLongitude, ...withoutModelLocation } = input;
  const optional = OPTIONAL_GATE_LOCATION.has(name);
  if (optional && previous) return withoutModelLocation;
  try {
    if (optional && (await navigator.permissions?.query({ name: 'geolocation' }))?.state !== 'granted') return withoutModelLocation;
    if (!navigator.geolocation) throw new Error('Location is unavailable.');
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: optional ? 1000 : 10000, maximumAge: 15000 }));
    return locationQuery ? { ...withoutModelLocation, currentLatitude: position.coords.latitude, currentLongitude: position.coords.longitude } : { ...withoutModelLocation, latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch (error) {
    if (optional) return withoutModelLocation;
    throw error;
  }
}
