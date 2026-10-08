export type NativeDeviceRequest = {
  id: string; kind: "location" | "photo"; state: string; ticketId: number | null;
  purpose: string; expiresAt: string; allowLibrary?: boolean;
  designatedDeviceId?: string; bindingVersion?: number;
  deviceId?: string;
  workerUserId?: number;
  result?: { late?: boolean; photo?: { noteId?: number; objectPath?: string } } | null;
};
export type NativeOperationsStatus = {
  policy: { enabled: boolean; automaticArrival?: boolean; modules?: string[]; dutyModes?: ("manual" | "ticket" | "scheduled")[] };
  duty: { active: boolean; startedAt?: string; mode?: string } | null;
  consent: { locationSharing: boolean; automaticArrival?: boolean };
  designatedDeviceId: string | null; bindingVersion: number;
  requests: NativeDeviceRequest[];
  company?: { type: "vendor" | "partner"; id: number };
  tasks?: NativePrimaryTask[];
  selectedTask?: { kind: "ticket" | "gate" | "fleet"; id: string } | null;
  shifts?: { id: string; title: string; startsAt: string; endsAt: string; siteLocationId: number | null }[];
  onCallWindows?: { startsAt: string; endsAt: string; consent: true }[];
};
export type NativePrimaryTask = { kind: "ticket" | "gate" | "fleet"; id: string; identifier: string; status: string; lastUpdate?: string; site?: string; startedAt?: string; eta?: string };
export function requestIsActionable(request: NativeDeviceRequest, now = Date.now()) {
  return ["pending", "delivered", "opened", "awaiting-worker", "upload-in-progress"].includes(request.state)
    && Number.isFinite(Date.parse(request.expiresAt)) && Date.parse(request.expiresAt) > now;
}
export function maySupplyFreshLocation(status: NativeOperationsStatus, deviceId: string) {
  const agreedWindow = status.onCallWindows?.some(window => window.consent && Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now());
  return status.policy.enabled && (status.duty?.active === true || agreedWindow === true) && status.consent.locationSharing
    && status.designatedDeviceId === deviceId;
}
export function arrivalMayBeAutomatic(status: NativeOperationsStatus) {
  return status.policy.automaticArrival === true && status.consent.automaticArrival === true;
}
export function nativeRequestRoute(id: unknown): string | null {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? `/work-hub/native-operations?requestId=${encodeURIComponent(id)}` : null;
}
