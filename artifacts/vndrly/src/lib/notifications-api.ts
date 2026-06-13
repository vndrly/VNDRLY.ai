const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type NotificationRow = {
  id: number;
  userId: number;
  type: string;
  category: string;
  dedupeKey: string | null;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

export type NotificationPreferences = {
  userId: number;
  ticketsEnabled: boolean;
  hotlistEnabled: boolean;
  complianceEnabled: boolean;
  crewEnabled: boolean;
  systemEnabled: boolean;
  visitorEnabled: boolean;
  pushEnabled: boolean;
  dndStartHour: number | null;
  dndEndHour: number | null;
  // Task #796: per-channel opt-in for "your QB account-mapping bulk action
  // is about to fall out of the undo window" warnings. Both default to true
  // server-side so existing users don't regress silently. The settings UI
  // composes these into a single 4-option picker (In-app | Email | Both | Off).
  qbBulkExpiryInAppEnabled: boolean;
  qbBulkExpiryEmailEnabled: boolean;
  // Task #47: per-category email delivery for the standard alerts pipeline
  // (kickbacks, expiring certs, Hotlist awards, etc.). The high-priority
  // categories (tickets, hotlist, compliance) default to ON server-side so
  // brand-new users still receive critical emails out of the box.
  ticketsEmailEnabled: boolean;
  hotlistEmailEnabled: boolean;
  complianceEmailEnabled: boolean;
  crewEmailEnabled: boolean;
  systemEmailEnabled: boolean;
  visitorEmailEnabled: boolean;
  // When true, *low-priority* alerts batch into a single daily email
  // instead of one email per event. High-priority alerts still ship
  // immediately. See `notification-email-digest.ts` on the server.
  emailDigestEnabled: boolean;
  // Task #50 — comments thread fan-out toggles. `commentsEnabled`
  // gates in-app + push for both @mentions and reply notifications.
  // Email channels split because mentions are instant high-priority
  // alerts while replies batch into the every-5-minute digest, and
  // people want them tunable independently.
  commentsEnabled: boolean;
  commentMentionEmailEnabled: boolean;
  commentReplyEmailEnabled: boolean;
};

// Task #699 — every error this helper throws carries `status`, `data`, and
// `headers`. The notifications-bell + notifications page use this so the
// shared `useRateLimitGate` hook (which keys off these fields) can detect
// a 429 with `code: "notifications.rate_limited"` and park the polling.
// We try to parse JSON regardless of `Content-Type` because the rate-limit
// factory always responds with a structured JSON body even on 429.
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

export const notificationsApi = {
  list: () => jsonFetch<NotificationRow[]>("/api/notifications"),
  unreadCount: () => jsonFetch<{ count: number }>("/api/notifications/unread-count"),
  markRead: (id: number) => jsonFetch<void>(`/api/notifications/${id}/read`, { method: "POST" }),
  markUnread: (id: number) => jsonFetch<void>(`/api/notifications/${id}/unread`, { method: "POST" }),
  delete: (id: number) => jsonFetch<void>(`/api/notifications/${id}`, { method: "DELETE" }),
  markAllRead: () => jsonFetch<void>("/api/notifications/read-all", { method: "POST" }),
  getPreferences: () => jsonFetch<NotificationPreferences>("/api/notifications/preferences"),
  updatePreferences: (patch: Partial<NotificationPreferences>) =>
    jsonFetch<NotificationPreferences>("/api/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
