/** Query string for the login page to load org branding from Postgres/Supabase. */
export function loginBrandQueryFromContext(ctx: {
  partnerId: number | null;
  vendorId: number | null;
}): string | null {
  if (ctx.partnerId) return `partnerId=${ctx.partnerId}`;
  if (ctx.vendorId) return `vendorId=${ctx.vendorId}`;
  return null;
}

export function parseLoginBrandQuery(query: Record<string, unknown>): {
  orgType: "partner" | "vendor";
  orgId: number;
} | null {
  const partnerId = Number(query.partnerId);
  if (Number.isFinite(partnerId) && partnerId > 0) {
    return { orgType: "partner", orgId: partnerId };
  }
  const vendorId = Number(query.vendorId);
  if (Number.isFinite(vendorId) && vendorId > 0) {
    return { orgType: "vendor", orgId: vendorId };
  }
  return null;
}
