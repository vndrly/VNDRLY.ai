import { parseTicketIdFromHref } from "@/lib/assistant-deep-links";

export type AssistantInlineSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string };
/** Normalize unicode punctuation Claude sometimes emits instead of ASCII markdown. */
export function normalizeAssistantMarkdownInput(text: string): string {
  return text
    .replace(/\uFF3B/g, "[")
    .replace(/\uFF3D/g, "]")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\\([\[\]()])/g, "$1")
    .replace(/\]\s+\(/g, "](")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

/** Unwrap bold markers around markdown links so the link parser can see them. */
export function unwrapBoldMarkdownLinks(text: string): string {
  return text.replace(
    /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g,
    "[$1]($2)",
  );
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
const BOLD = /\*\*([^*]+)\*\*/;
const CODE = /`([^`]+)`/;
const BARE_DEEP_LINK = /VNDRLY-deep-link:[^\s)\]>]+/i;
const BARE_TICKET_PATH = /\/tickets?\/\d+/i;

function earliestMatch(
  rest: string,
): { idx: number; len: number; segment: AssistantInlineSegment } | null {
  const candidates: Array<{ idx: number; len: number; segment: AssistantInlineSegment }> = [];

  const linkMatch = MARKDOWN_LINK.exec(rest);
  if (linkMatch) {
    candidates.push({
      idx: linkMatch.index,
      len: linkMatch[0].length,
      segment: { kind: "link", label: linkMatch[1], href: linkMatch[2].trim() },
    });
  }

  const boldMatch = BOLD.exec(rest);
  if (boldMatch) {
    candidates.push({
      idx: boldMatch.index,
      len: boldMatch[0].length,
      segment: { kind: "bold", text: boldMatch[1] },
    });
  }

  const codeMatch = CODE.exec(rest);
  if (codeMatch) {
    candidates.push({
      idx: codeMatch.index,
      len: codeMatch[0].length,
      segment: { kind: "code", text: codeMatch[1] },
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.idx - b.idx);
  return candidates[0]!;
}

function linkifyPlainText(text: string): AssistantInlineSegment[] {
  if (!text) return [];
  const pattern = new RegExp(
    `(${BARE_DEEP_LINK.source}|${BARE_TICKET_PATH.source})`,
    "gi",
  );
  const segments: AssistantInlineSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    const href = match[0];
    const ticketId = parseTicketIdFromHref(href);
    const label =
      ticketId != null
        ? `Open ticket #${ticketId}`
        : href.startsWith("/")
          ? `Open ticket ${href.split("/").pop()}`
          : "Open link";
    segments.push({
      kind: "link",
      label,
      href,
    });
    last = match.index + href.length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

/** Parse assistant inline markdown into tappable segments. */
export function parseAssistantInlineSegments(raw: string): AssistantInlineSegment[] {
  const input = unwrapBoldMarkdownLinks(normalizeAssistantMarkdownInput(raw));
  const segments: AssistantInlineSegment[] = [];
  let rest = input;

  while (rest.length > 0) {
    const next = earliestMatch(rest);
    if (!next) {
      segments.push(...linkifyPlainText(rest));
      break;
    }
    if (next.idx > 0) {
      segments.push(...linkifyPlainText(rest.slice(0, next.idx)));
    }
    if (next.segment.kind === "bold") {
      segments.push(...parseAssistantInlineSegments(next.segment.text));
    } else {
      segments.push(next.segment);
    }
    rest = rest.slice(next.idx + next.len);
  }

  return segments;
}

/** Flatten to plain text (for tests asserting markdown was parsed). */
export function assistantInlinePlainText(segments: AssistantInlineSegment[]): string {
  return segments
    .map((s) => {
      if (s.kind === "link") return s.label;
      if (s.kind === "bold") return s.text;
      if (s.kind === "code") return s.text;
      return s.text;
    })
    .join("");
}
