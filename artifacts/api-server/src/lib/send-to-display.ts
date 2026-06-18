export type SendToGroupId =
  | "on_ticket"
  | "vendor_poc_field"
  | "vendor_poc_office"
  | "vendor_office"
  | "partner_poc_operations"
  | "partner_poc_ap"
  | "partner_office"
  | "field_crew"
  | "vndrly_office";

/** Stable UI row id — one checkbox per group slot, even when userId repeats. */
export function sendToRowKey(group: SendToGroupId, userId: number): string {
  return `${group}:${userId}`;
}

/** Strip synthetic test-user prefixes so labels read like real roster names. */
export function humanizeDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  const testMatch = /^void-audit-\d+-[a-z0-9]+-(.+)$/i.exec(trimmed);
  if (testMatch) return testMatch[1].trim();
  return trimmed;
}

export function humanizeOrgName(orgName: string | null | undefined): string {
  const trimmed = (orgName ?? "").trim();
  if (!trimmed) return "";
  const testMatch = /^void-audit-\d+-[a-z0-9]+-(.+)$/i.exec(trimmed);
  if (testMatch) return testMatch[1].trim();
  return trimmed;
}

export function personHeadline(
  profile: { displayName: string },
  preferred?: string | null,
): string {
  const pref = preferred?.trim();
  if (pref) return pref;
  return humanizeDisplayName(profile.displayName);
}

export type SendToDetailContext = {
  group: SendToGroupId;
  vendorName?: string | null;
  partnerName?: string | null;
  /** Short role phrase shown inside the detail line (foreman name, AP, etc.). */
  pocRole?: string | null;
  orgSide?: "vendor" | "partner" | "platform" | "unknown";
};

export function formatSendToDetail(ctx: SendToDetailContext): string {
  const vendor = humanizeOrgName(ctx.vendorName) || "Vendor";
  const partner = humanizeOrgName(ctx.partnerName) || "Partner";
  const poc = ctx.pocRole?.trim();

  switch (ctx.group) {
    case "on_ticket":
      if (ctx.orgSide === "vendor") return `${vendor} · on this ticket`;
      if (ctx.orgSide === "partner") return `${partner} · on this ticket`;
      if (ctx.orgSide === "platform") return "VNDRLY · on this ticket";
      return `${vendor} · on this ticket`;
    case "vendor_poc_field":
      return poc
        ? `${vendor} · POC for ${poc}`
        : `${vendor} · POC for field & jobs`;
    case "vendor_poc_office":
      return poc
        ? `${vendor} · vendor office POC (${poc})`
        : `${vendor} · vendor office / billing POC`;
    case "vendor_office":
      return `${vendor} · vendor office`;
    case "partner_poc_operations":
      return poc
        ? `${partner} · tickets & field work (${poc})`
        : `${partner} · tickets & field work`;
    case "partner_poc_ap":
      return poc
        ? `${partner} · payment & resolution (${poc})`
        : `${partner} · payment & resolution`;
    case "partner_office":
      return `${partner} · partner office`;
    case "field_crew":
      return poc
        ? `${vendor} · field crew (${poc})`
        : `${vendor} · field crew`;
    case "vndrly_office":
      return "VNDRLY platform staff";
    default:
      return "";
  }
}
