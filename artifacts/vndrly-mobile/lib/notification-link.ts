import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";

export function stripLinkQuery(href: string): string {
  const idx = href.indexOf("?");
  return idx >= 0 ? href.slice(0, idx) : href;
}

/** Ticket id from notification link — path (`/tickets/42`) or query (`?ticketId=42`). */
export function parseTicketIdFromNotificationLink(href: string): number | null {
  const fromPath = parseTicketIdFromHref(href);
  if (fromPath !== null) return fromPath;
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, "https://vndrly.ai");
    const raw = url.searchParams.get("ticketId");
    if (raw) {
      const id = Number(raw);
      if (Number.isInteger(id) && id > 0) return id;
    }
  } catch {
    // ignore
  }
  return null;
}

export function parseSafetyEventIdFromHref(href: string): number | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  const pathOnly = stripLinkQuery(trimmed);
  const match = pathOnly.match(/\/safety\/(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseSiteLocationFromHref(href: string): { id: number; name: string | null } | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, "https://vndrly.ai");
    const rawId = url.searchParams.get("siteLocationId");
    if (!rawId || !Number.isFinite(Number(rawId))) return null;
    const name = url.searchParams.get("siteName");
    return { id: Number(rawId), name: name ?? null };
  } catch {
    return null;
  }
}
