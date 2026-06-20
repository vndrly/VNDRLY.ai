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

export type AssistantShareMailtoInput = {
  question: string;
  answer: string;
  pagePath: string;
  typeLabel?: string;
};

function absoluteAppLink(path: string): string {
  const origin = appOrigin();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}

/** Pre-filled mailto for sharing an AskV Q&A outside the in-app Send to roster. */
export function buildAssistantShareMailtoUrl(input: AssistantShareMailtoInput): string {
  const subject = `AskV — ${input.question.trim() || "Shared answer"}`.slice(0, 200);
  const lines = [
    input.typeLabel ?? "AskV message",
    "",
    `Question: ${input.question.trim() || "—"}`,
    "",
    input.answer.trim(),
    "",
    `View in VNDRLY: ${absoluteAppLink(input.pagePath)}`,
  ];
  const body = lines.filter((line) => line.length > 0).join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
