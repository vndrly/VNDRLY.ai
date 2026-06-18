import { getApiBase } from "@/lib/api";
import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";

export type NotificationMailtoInput = {
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  typeLabel: string;
};

function absoluteWebLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = getApiBase().replace(/\/$/, "");
  return `${base}${link.startsWith("/") ? link : `/${link}`}`;
}

function mobileDeepLink(link: string | null): string | null {
  const ticketId = parseTicketIdFromHref(link ?? "");
  if (ticketId === null) return null;
  return `vndrly-deep-link:ticket-detail/${ticketId}`;
}

/** Pre-filled mailto body mirroring the web notifications modal. */
export function buildNotificationMailtoUrl(n: NotificationMailtoInput): string {
  const subject = n.title;
  const lines = [
    n.typeLabel,
    "",
    n.title,
    n.body ? n.body : null,
    "",
    `Received: ${new Date(n.createdAt).toLocaleString()}`,
  ];
  const web = absoluteWebLink(n.link);
  const app = mobileDeepLink(n.link);
  if (web) lines.push("", `View on web: ${web}`);
  if (app) lines.push(`Open in VNDRLY app: ${app}`);
  const body = lines.filter((line) => line != null).join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
