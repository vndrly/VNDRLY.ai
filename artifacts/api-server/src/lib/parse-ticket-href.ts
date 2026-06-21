/** Extract a ticket id from notification / deep-link href shapes. */
export function parseTicketIdFromHref(href: string): number | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const deepPatterns = [
    /^vndrly-deep-link:ticket-detail\/(\d+)/i,
    /^vndrly-deep-link:ticket-detail:(\d+)/i,
    /^vndrly-deep-link:ticket-detail\?id=(\d+)/i,
    /^vndrly-deep-link:ticket-detail\?(\d+)/i,
    /^vndrly-deep-link:tickets\/(\d+)/i,
  ];
  for (const re of deepPatterns) {
    const m = re.exec(trimmed);
    if (m) {
      const id = Number(m[1]);
      if (Number.isInteger(id) && id > 0) return id;
    }
  }

  const pathMatch = trimmed.match(/\/tickets?\/(\d+)/i);
  if (pathMatch) {
    const id = Number(pathMatch[1]);
    if (Number.isInteger(id) && id > 0) return id;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const urlMatch = u.pathname.match(/\/tickets?\/(\d+)/i);
      if (urlMatch) {
        const id = Number(urlMatch[1]);
        if (Number.isInteger(id) && id > 0) return id;
      }
    } catch {
      // ignore
    }
  }

  return null;
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
