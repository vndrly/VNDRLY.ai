import { apiFetch } from "@/lib/api";

/** Row shape used by the mobile home + history ticket lists. */
export type MobileOpenTicket = {
  id: number;
  status: string;
  siteLocationId: number | null;
  siteName: string | null;
  partnerName: string | null;
  vendorName: string | null;
  workTypeName: string | null;
  fieldEmployeeId: number | null;
  fieldEmployeeFirstName: string | null;
  fieldEmployeeLastName: string | null;
  crewNames?: string[];
  createdAt: string;
  updatedAt: string | null;
  unreadCommentCount: number;
};

export type PortalTicketRow = {
  id: number;
  status: string;
  siteLocationId: number;
  siteName: string | null;
  partnerName: string | null;
  vendorName: string | null;
  workTypeName: string | null;
  fieldEmployeeId: number | null;
  fieldEmployeeName: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  unreadCommentCount?: number;
};

function splitEmployeeName(full: string | null | undefined): {
  first: string | null;
  last: string | null;
} {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { first: null, last: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function mapPortalTicket(row: PortalTicketRow): MobileOpenTicket {
  const { first, last } = splitEmployeeName(row.fieldEmployeeName);
  return {
    id: row.id,
    status: row.status,
    siteLocationId: row.siteLocationId ?? null,
    siteName: row.siteName ?? null,
    partnerName: row.partnerName ?? null,
    vendorName: row.vendorName ?? null,
    workTypeName: row.workTypeName ?? null,
    fieldEmployeeId: row.fieldEmployeeId ?? null,
    fieldEmployeeFirstName: first,
    fieldEmployeeLastName: last,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt != null
          ? String(row.updatedAt)
          : null,
    unreadCommentCount: row.unreadCommentCount ?? 0,
  };
}

/** Partner/vendor/admin Site tickets — same list as web Tracking (`GET /api/tickets`). */
export async function fetchPortalTicketsForHome(): Promise<MobileOpenTicket[]> {
  const rows = await apiFetch<PortalTicketRow[]>("/api/tickets");
  return (rows ?? []).map(mapPortalTicket).sort((a, b) => {
    const aTs = Date.parse(a.updatedAt ?? a.createdAt);
    const bTs = Date.parse(b.updatedAt ?? b.createdAt);
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });
}
