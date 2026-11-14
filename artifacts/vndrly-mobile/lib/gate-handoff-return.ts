let pending: { siteId: number; stationId: string; expiresAt: number } | null =
  null;
export function rememberGateHandoff(siteId: number, stationId: string) {
  pending = { siteId, stationId, expiresAt: Date.now() + 15 * 60 * 1000 };
}
export function peekGateHandoffDestination() {
  const value = pending;
  return value && value.expiresAt > Date.now()
    ? "/handoff?purpose=assume&siteId=" +
        value.siteId +
        "&stationId=" +
        encodeURIComponent(value.stationId)
    : null;
}

export function takeGateHandoffDestination() {
  const path = peekGateHandoffDestination();
  pending = null;
  return path;
}
