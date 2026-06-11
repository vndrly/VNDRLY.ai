export type RecentTripsSession = {
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  vendorRole?: string | null;
};

export type RecentTripsScope =
  | {
      ok: true;
      vendorId: number | null;
      partnerId: number | null;
      siteLocationId: number | null;
    }
  | { ok: false; status: number; body: { code: string; error: string } };

/** Who may read `/api/map/recent-trips` and how rows are scoped. */
export function resolveRecentTripsScope(
  session: RecentTripsSession,
  query: { vendorId?: number | null; siteLocationId?: number | null },
): RecentTripsScope {
  const siteLocationId =
    query.siteLocationId != null && Number.isFinite(query.siteLocationId)
      ? query.siteLocationId
      : null;
  const filterVendorId =
    query.vendorId != null && Number.isFinite(query.vendorId) ? query.vendorId : null;

  if (session.role === "partner") {
    if (!session.partnerId) {
      return { ok: false, status: 403, body: { code: "visitor.no_partner", error: "no_partner" } };
    }
    return {
      ok: true,
      vendorId: null,
      partnerId: session.partnerId,
      siteLocationId,
    };
  }

  if (session.role === "vendor") {
    if (!session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.no_vendor", error: "no_vendor" } };
    }
    if (filterVendorId && filterVendorId !== session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.wrong_vendor", error: "wrong_vendor" } };
    }
    return {
      ok: true,
      vendorId: session.vendorId,
      partnerId: null,
      siteLocationId,
    };
  }

  if (session.role === "field_employee") {
    const isForeman =
      session.vendorRole === "foreman" || session.vendorRole === "both";
    if (!isForeman) {
      return { ok: false, status: 403, body: { code: "visitor.forbidden", error: "forbidden" } };
    }
    if (!session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.no_vendor", error: "no_vendor" } };
    }
    if (filterVendorId && filterVendorId !== session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.wrong_vendor", error: "wrong_vendor" } };
    }
    return {
      ok: true,
      vendorId: session.vendorId,
      partnerId: null,
      siteLocationId,
    };
  }

  if (session.role === "admin") {
    return {
      ok: true,
      vendorId: filterVendorId,
      partnerId: null,
      siteLocationId,
    };
  }

  return { ok: false, status: 403, body: { code: "visitor.forbidden", error: "forbidden" } };
}
