type LiveLocationsSession = {
  role: string;
  vendorId: number | null;
  vendorRole?: string | null;
};

export type LiveLocationsScope =
  | { ok: true; scopedVendorId: number | null }
  | { ok: false; status: number; body: { code: string; error: string } };

/** Who may read `/api/live-locations` (+ SSE) and how vendor scope is applied. */
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
    return { ok: true, scopedVendorId: session.vendorId };
  }
  if (session.role === "admin") {
    return { ok: true, scopedVendorId: filterVendorId };
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
    return { ok: true, scopedVendorId: session.vendorId };
  }
  return { ok: false, status: 403, body: { code: "visitor.forbidden", error: "forbidden" } };
}
