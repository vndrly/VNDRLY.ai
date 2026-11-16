import type { JournalEntry } from "./native-operation-journal";

export type OfflineGateVisit = {
  id: number; siteLocationId: number; firstName: string; lastName: string;
  company: string | null; vehiclePlate: string | null; plateState: string | null;
  checkInTime: string; checkOutTime?: string | null;
};
export type OfflineGateSnapshot = {
  siteId: number; siteName: string; stationId: string; stationName: string;
  capturedAt: number; visits: OfflineGateVisit[]; complete?: boolean;
};
export type OfflineGatePayload = {
  siteLocationId: number; gateStationId?: string; direction: "entry" | "exit";
  plate?: string; plateState?: string; originalVisitId?: number; entryOperationId?: string;
  reportedVisitor?: { firstName: string; lastName: string; company?: string; purpose?: string; notes?: string };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Validate the authenticated WebView bridge; cache facts, never cached authorization. */
export function parseOfflineGateSnapshot(value: unknown): OfflineGateSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as OfflineGateSnapshot;
  if (!Number.isSafeInteger(v.siteId) || v.siteId <= 0 || !uuid.test(v.stationId) ||
    typeof v.siteName !== "string" || v.siteName.length > 300 ||
    typeof v.stationName !== "string" || v.stationName.length > 300 ||
    !Number.isFinite(v.capturedAt) || v.capturedAt > Date.now() + 60_000 ||
    !Array.isArray(v.visits) || v.visits.length > 5000) return null;
  const visits: OfflineGateVisit[] = [];
  for (const row of v.visits) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || row.siteLocationId !== v.siteId ||
      typeof row.firstName !== "string" || typeof row.lastName !== "string" ||
      [row.company, row.vehiclePlate, row.plateState, row.checkOutTime].some(x => x != null && typeof x !== "string") ||
      !Number.isFinite(Date.parse(row.checkInTime))) return null;
    visits.push({ id: row.id, siteLocationId: row.siteLocationId, firstName: row.firstName.slice(0, 100),
      lastName: row.lastName.slice(0, 100), company: row.company?.slice(0, 200) ?? null,
      vehiclePlate: row.vehiclePlate?.slice(0, 32) ?? null, plateState: row.plateState?.slice(0, 8) ?? null,
      checkInTime: row.checkInTime, checkOutTime: row.checkOutTime });
  }
  return { siteId: v.siteId, siteName: v.siteName, stationId: v.stationId,
    stationName: v.stationName, capturedAt: v.capturedAt, visits, complete: v.complete === true };
}
export type OfflinePerson = {
  key: string; firstName: string; lastName: string; company?: string | null;
  vehiclePlate?: string | null; plateState?: string | null; checkInTime: string;
  originalVisitId?: number; entryOperationId?: string;
};
/** Merge last server facts with device observations without counting a synced entry twice. */
export function offlinePeople(snapshot: OfflineGateSnapshot, journal: JournalEntry[]): OfflinePerson[] {
  const events = journal.filter(e => e.domain === "gate" && (e.payload as OfflineGatePayload).siteLocationId === snapshot.siteId);
  const exits = events.filter(e => (e.payload as OfflineGatePayload).direction === "exit");
  const locallyClosed = new Set(exits.map(e => (e.payload as OfflineGatePayload).entryOperationId).filter(Boolean));
  const closedIds = new Set(exits.map(e => (e.payload as OfflineGatePayload).originalVisitId ?? e.receipt?.id).filter(Boolean));
  const localEntries = events.filter(e => (e.payload as OfflineGatePayload).direction === "entry");
  const knownIds = new Set(localEntries.map(e => e.receipt?.id).filter(Boolean));
  const people: OfflinePerson[] = snapshot.visits.filter(v => !v.checkOutTime && !knownIds.has(v.id) && !closedIds.has(v.id))
    .map(v => ({ ...v, key: `visit:${v.id}`, originalVisitId: v.id }));
  for (const entry of localEntries) {
    if (locallyClosed.has(entry.operationId) || (entry.receipt && closedIds.has(entry.receipt.id))) continue;
    // A newer server snapshot may have confirmed an exit from another device.
    if (snapshot.complete && entry.receipt && entry.syncedAt && snapshot.capturedAt > Date.parse(entry.syncedAt) &&
      !snapshot.visits.some(v => v.id === entry.receipt!.id && !v.checkOutTime)) continue;
    const p = entry.payload as OfflineGatePayload;
    if (!p.reportedVisitor) continue;
    people.push({ key: entry.operationId, ...p.reportedVisitor, vehiclePlate: p.plate,
      plateState: p.plateState, checkInTime: entry.capturedAt, entryOperationId: entry.operationId });
  }
  return people;
}
