let pending: string | null = null;
export function rememberMeetingDestination(path: string) {
  const campaign = path.match(
    /^\/work-hub\/(form|campaign|training|checklist|library|bundle)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (campaign) {
    pending = path;
    return;
  }
  const m = path.match(
    /^\/work-hub\/meetings?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (m) pending = `/work-hub/meeting/${m[1]}`;
}
export function pendingMeetingDestination() {
  return pending;
}
export function clearMeetingDestination() {
  pending = null;
}
