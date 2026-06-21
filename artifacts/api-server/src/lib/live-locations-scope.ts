type LiveLocationsSession = {
  role: string;
  vendorId: number | null;
  partnerId?: number | null;
  vendorRole?: string | null;
};

export type LiveLocationsScope =
  | { ok: true; scopedVendorId: number | null; scopedPartnerId: number | null }
  | { ok: false; status: number; body: { code: string; error: string } };

/** Who may read `/api/live-locations` (+ SSE) and how vendor/partner scope is applied. */
export function resolveLiveLocationsScope(
  session: LiveLocationsSession,
  filterVendorId: number | null,
): LiveLocationsScope {
  if (session.role === "vendor") {
    if (!session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.no_vendor", error: "no_vendor" } };
    }
    if (filterVendorId && filterVendorId !== session.vendorId) {
      return { ok: false, status: 403, body: { code: "visitor.wrong_vendor", error: "wrong_vendor" } };
    }
    return { ok: true, scopedVendorId: session.vendorId, scopedPartnerId: null };
  }
  if (session.role === "admin") {
    return { ok: true, scopedVendorId: filterVendorId, scopedPartnerId: null };
  }
  if (session.role === "partner") {
    if (!session.partnerId) {
      return { ok: false, status: 403, body: { code: "visitor.forbidden", error: "forbidden" } };
    }
    return { ok: true, scopedVendorId: null, scopedPartnerId: session.partnerId };
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
    return { ok: true, scopedVendorId: session.vendorId, scopedPartnerId: null };
  }
  return { ok: false, status: 403, body: { code: "visitor.forbidden", error: "forbidden" } };
}
