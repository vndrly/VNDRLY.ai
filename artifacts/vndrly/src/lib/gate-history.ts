import type { VisitorRow } from "@/lib/visits-api";
import { plateMatchesSearch } from "@workspace/plate-state";

export const GATE_HISTORY_DAYS = 30;

export function gateHistoryFromIso(now = new Date()): string {
  return new Date(now.getTime() - GATE_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function haystack(visit: VisitorRow): string {
  return [
    visit.firstName,
    visit.lastName,
    `${visit.firstName} ${visit.lastName}`,
    visit.company,
    visit.vehiclePlate,
    visit.siteName,
    visit.purpose,
    visit.hostPartnerName,
    visit.hostVendorName,
    visit.phone,
    visit.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function visitMatchesHistorySearch(visit: VisitorRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack(visit).includes(needle)
    || plateMatchesSearch(visit.plateState, visit.vehiclePlate, query);
}

export function sortHistoryNewestFirst(visits: VisitorRow[]): VisitorRow[] {
  return [...visits].sort((a, b) => Date.parse(b.checkInTime) - Date.parse(a.checkInTime));
}

export function filterGateHistory(visits: VisitorRow[], query: string): VisitorRow[] {
  return sortHistoryNewestFirst(visits.filter((visit) => visitMatchesHistorySearch(visit, query)));
}

/** Recent departures belong to the selected site and sort by actual checkout,
 * not by arrival time. Invalid or still-open records are not departures. */
export function gateDeparturesForSite(visits: VisitorRow[], siteId: number | undefined): VisitorRow[] {
  if (!siteId) return [];
  return visits.filter(visit => visit.siteLocationId === siteId && visit.checkOutTime != null && Number.isFinite(Date.parse(visit.checkOutTime)))
    .sort((a, b) => Date.parse(b.checkOutTime!) - Date.parse(a.checkOutTime!) || b.id - a.id);
}
