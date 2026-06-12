import type { HotlistJobStatus, HotlistBidStatus } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type HotlistJobRow = {
  convertedTicketId?: number | null;
  id: number;
  partnerId: number;
  partnerName?: string | null;
  partnerLogoUrl?: string | null;
  title: string;
  description: string | null;
  locationAddress: string;
  latitude: number | null;
  longitude: number | null;
  deadline: string | null;
  estimatedDurationDays: number | null;
  status: HotlistJobStatus;
  awardedBidId?: number | null;
  awardedVendorId?: number | null;
  createdAt: string;
  deletedAt?: string | null;
  bidCount?: number;
  distanceMiles?: number;
  myBid?: HotlistBidRow | null;
  // Task #495 — only present on the vendor-facing list. Indicates this
  // vendor's relationship tier with the job's posting partner. Used by
  // the UI to gate the Bid CTA: only "approved" vendors can place bids.
  myTier?: "approved" | "unapproved" | "pre_onboarded";
  // Task #51 — count of unread comments on this job's thread for the
  // signed-in viewer. Server-computed; clears once the user opens the
  // job detail (which calls markAllSeen on its comments fetch) and the
  // hotlist list re-fetches.
  unreadCommentCount?: number;
};

export type HotlistBidRow = {
  id: number;
  jobId: number;
  vendorId: number;
  vendorName?: string | null;
  amountUsd: string;
  etaDays: number | null;
  notes: string | null;
  status: HotlistBidStatus;
  createdAt: string;
  /**
   * The (job.partner ↔ bid.vendor) partner_vendor_relationships.status.
   * `null` means unaffiliated. Returned by the partner-facing job
   * detail endpoint so the bid list can show preferred/approved badges
   * and decide whether to hide unaffiliated bids by default.
   */
  relationshipStatus?: "preferred" | "approved" | null;
  // Task #847 — eligibility annotation mirroring the Direct Award
  // candidate dropdown contract (Task #502). Returned only by the
  // partner-facing job detail endpoint so the bid list can grey out
  // bidders who would be rejected at award time and explain why.
  distanceMiles?: number | null;
  operatingRadiusMiles?: number | null;
  inRadius?: boolean;
  compliancePassed?: boolean;
  eligible?: boolean;
  ineligibleReason?:
    | "vendor_no_operating_area"
    | "job_not_geocoded"
    | "vendor_out_of_radius"
    | "missing_coi_document"
    | "missing_insurance_expiration"
    | "expired_insurance"
    | "missing_federal_tax_id"
    | null;
  ineligibleMessage?: string | null;
};

export type HotlistJobDetail = HotlistJobRow & {
  bids: HotlistBidRow[];
  unaffiliatedCount?: number;
  totalBidCount?: number;
};

export type VendorListResponse = {
  jobs: HotlistJobRow[];
  reason?: string;
  vendor?: { latitude: number | null; longitude: number | null; operatingRadiusMiles: number | null } | null;
  // Returned when the vendor's work-type catalog is non-empty. The
  // hotlist UI uses this to render a "filtered" pill and a "show all"
  // escape hatch (which sets `includeAll=1`).
  catalog?: {
    size: number;
    filteredCount: number;
    includeAll: boolean;
  };
};

// Task #699 — every error this helper throws carries `status`, `data`, and
// `headers`. The hotlist views (partner/vendor/admin) use this so the
// shared `useRateLimitGate` hook can detect a 429 with
// `code: "hotlist.rate_limited"` and park the polling. We keep the existing
// "human-readable error.message" behaviour so existing toast callsites
// (translateApiError) keep rendering the same copy.
async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${input}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // 4xx/5xx responses with no body or a non-JSON body just leave data null.
    }
    const message =
      (data &&
        typeof data === "object" &&
        ((data as { error?: string }).error || (data as { message?: string }).message)) ||
      `HTTP ${res.status}`;
    const err = new Error(String(message)) as Error & {
      status: number;
      data: unknown;
      headers: Headers;
    };
    err.status = res.status;
    err.data = data;
    err.headers = res.headers;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type OperatingArea = {
  vendorId: number;
  operatingRadiusMiles: number | null;
  latitude: number | null;
  longitude: number | null;
  geocodedAt: string | null;
  physicalAddress: string | null;
};

export const hotlistApi = {
  getOperatingArea: (vendorId: number) => jsonFetch<OperatingArea>(`/api/hotlist/vendors/${vendorId}/operating-area`),
  list: (opts?: { includeDeleted?: boolean; includeAll?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.includeDeleted) params.set("includeDeleted", "true");
    if (opts?.includeAll) params.set("includeAll", "1");
    const qs = params.toString();
    return jsonFetch<HotlistJobRow[] | VendorListResponse>(
      `/api/hotlist/jobs${qs ? `?${qs}` : ""}`,
    );
  },
  getJob: (id: number, opts?: { includeUnaffiliated?: boolean }) =>
    jsonFetch<HotlistJobDetail>(
      `/api/hotlist/jobs/${id}${opts?.includeUnaffiliated ? "?includeUnaffiliated=1" : ""}`,
    ),
  createJob: (body: { title: string; description?: string | null; locationAddress: string; deadline?: string | null; estimatedDurationDays?: number | null; partnerId?: number; workTypeId?: number | null }) =>
    jsonFetch<HotlistJobRow>("/api/hotlist/jobs", { method: "POST", body: JSON.stringify(body) }),
  deleteJob: (id: number) => jsonFetch<void>(`/api/hotlist/jobs/${id}`, { method: "DELETE" }),
  restoreJob: (id: number) => jsonFetch<HotlistJobRow>(`/api/hotlist/jobs/${id}/restore`, { method: "POST" }),
  bid: (jobId: number, body: { amountUsd: number; etaDays?: number | null; notes?: string | null }) =>
    jsonFetch<HotlistBidRow>(`/api/hotlist/jobs/${jobId}/bids`, { method: "POST", body: JSON.stringify(body) }),
  award: (bidId: number) => jsonFetch<HotlistJobRow>(`/api/hotlist/bids/${bidId}/award`, { method: "POST" }),
  // Task #495 — Direct Award. Partner hand-picks a vendor for an open
  // hotlist job, skipping the bid auction. The chosen vendor must clear
  // the compliance floor (COI + tax id + matching work type) and be
  // within radius of the site.
  directAward: (body: {
    hotlistJobId: number;
    vendorId: number;
    siteLocationId: number;
    workTypeId: number;
    scheduledStartAt?: string | null;
    scheduledDurationMinutes?: number | null;
  }) =>
    jsonFetch<{ id: number }>(`/api/tickets/direct-award`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Converts an awarded hotlist job (status='awarded') into a real ticket
  // bound to the awarded vendor. Partner picks site_location_id and
  // work_type_id from their catalog. Marks the hotlist job's
  // convertedTicketId so the UI hides the Convert button afterwards.
  convertToTicket: (
    hotlistJobId: number,
    body: {
      siteLocationId: number;
      workTypeId: number;
      scheduledStartAt?: string | null;
      scheduledDurationMinutes?: number | null;
    },
  ) =>
    jsonFetch<{ ticketId: number; convertedTicketId: number }>(
      `/api/hotlist/jobs/${hotlistJobId}/convert`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  setOperatingArea: (vendorId: number, body: { operatingRadiusMiles: number | null; refreshGeocode?: boolean }) =>
    jsonFetch<{ id: number; operatingRadiusMiles: number | null; latitude: number | null; longitude: number | null; geocodedAt: string | null; geocodeWarning?: string | null; geocodeUsedQuery?: string | null }>(
      `/api/hotlist/vendors/${vendorId}/operating-area`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
};

export function isVendorListResponse(x: HotlistJobRow[] | VendorListResponse): x is VendorListResponse {
  return !Array.isArray(x);
}
