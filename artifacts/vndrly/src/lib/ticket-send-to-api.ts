const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

export type SendToRecipient = {
  userId: number;
  displayName: string;
  email: string | null;
  group: SendToGroupId;
  roleLabel: string;
  headline?: string;
  detail?: string;
};

export type SendToRecipientGroups = {
  id: SendToGroupId;
  recipients: SendToRecipient[];
}[];

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${input}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const message =
      (data &&
        typeof data === "object" &&
        ((data as { error?: string }).error || (data as { message?: string }).message)) ||
      `HTTP ${res.status}`;
    const err = new Error(String(message)) as Error & { status: number; data: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return (await res.json()) as T;
}

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

export const ticketSendToApi = {
  listRecipientsForTicket: (ticketId: number) =>
    jsonFetch<{ groups: SendToRecipientGroups }>(`/api/tickets/${ticketId}/send-to-recipients`),

  listRecipientsForNotification: (notificationId: number) =>
    jsonFetch<{ ticketId: number; groups: SendToRecipientGroups }>(
      `/api/notifications/${notificationId}/send-to-recipients`,
    ),

  sendFromTicket: (
    ticketId: number,
    body: { recipientUserIds: number[]; message?: string | null; sourceTitle?: string; sourceBody?: string },
  ) =>
    jsonFetch<{ ok: true; notifiedCount: number; trackingNumber: string }>(
      `/api/tickets/${ticketId}/send-to`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  sendFromNotification: (
    notificationId: number,
    body: { recipientUserIds: number[]; message?: string | null },
  ) =>
    jsonFetch<{ ok: true; notifiedCount: number; trackingNumber: string; ticketId: number }>(
      `/api/notifications/${notificationId}/send-to`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  listRecipientsForAssistantMessage: (messageId: number, ticketId: number | null) => {
    const qs =
      ticketId != null ? `?ticketId=${encodeURIComponent(String(ticketId))}` : "";
    return jsonFetch<{ ticketId: number | null; groups: SendToRecipientGroups }>(
      `/api/assistant/messages/${messageId}/send-to-recipients${qs}`,
    );
  },

  sendFromAssistantMessage: (
    messageId: number,
    body: {
      recipientUserIds: number[];
      message?: string | null;
      ticketId?: number | null;
      pagePath?: string | null;
    },
  ) =>
    jsonFetch<{ ok: true; notifiedCount: number; trackingNumber: string; ticketId: number | null }>(
      `/api/assistant/messages/${messageId}/send-to`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};
