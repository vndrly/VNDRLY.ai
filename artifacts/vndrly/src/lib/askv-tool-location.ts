const LOCATION_TOOLS = new Set(['prepare_visitor_check_in', 'confirm_visitor_check_in', 'prepare_visitor_check_out', 'confirm_visitor_check_out', 'set_ticket_lifecycle', 'close_ticket_for_review']);

/** GPS is device evidence, never a coordinate guessed by the model. Keep it fixed for confirmation. */
export async function addAskVToolLocation(name: string, input: Record<string, unknown>, pending?: unknown): Promise<Record<string, unknown>> {
  if (!LOCATION_TOOLS.has(name)) return input;
  const previous = pending && typeof pending === 'object' ? pending as Record<string, unknown> : null;
  if (previous && typeof previous.latitude === 'number' && typeof previous.longitude === 'number') {
    return { ...input, latitude: previous.latitude, longitude: previous.longitude };
  }
  if (!navigator.geolocation) throw new Error('Location is unavailable. Open the existing form and provide the required location.');
  const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }));
  return { ...input, latitude: position.coords.latitude, longitude: position.coords.longitude };
}
