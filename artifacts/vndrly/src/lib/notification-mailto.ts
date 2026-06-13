import type { NotificationRow } from "@/lib/notifications-api";

function appOrigin(): string {
  if (typeof window === "undefined") return "";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}`;
}

function absoluteNotificationLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const origin = appOrigin();
  const path = link.startsWith("/") ? link : `/${link}`;
  return `${origin}${path}`;
}

export function buildNotificationMailtoUrl(
  n: NotificationRow,
  typeLabel: string,
): string {
  const subject = n.title;
  const lines = [
    typeLabel,
    "",
    n.title,
    n.body ? n.body : null,
    "",
    `Received: ${new Date(n.createdAt).toLocaleString()}`,
  ];
  const link = absoluteNotificationLink(n.link);
  if (link) {
    lines.push("", `View in VNDRLY: ${link}`);
  }
  const body = lines.filter((line) => line != null).join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
