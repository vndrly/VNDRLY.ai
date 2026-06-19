import { DEEP_LINK_SCREENS } from "./deep-links";

const SCREEN_PATH = Object.fromEntries(
  DEEP_LINK_SCREENS.map((d) => [d.screen, d.pattern.split("?")[0] ?? d.pattern]),
);

const LINK_LABELS: Record<string, string> = {
  "bills-to-pay": "Open Bills to Pay",
  invoices: "Open Invoices",
  reports: "Open Reports",
  tickets: "Open Tickets",
  statement: "Open Statements",
  dashboard: "Open Dashboard",
};

function linkLabelForUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const screen = DEEP_LINK_SCREENS.find((d) => {
    const pattern = d.pattern.split("?")[0] ?? d.pattern;
    if (pattern.includes(":id")) {
      const prefix = pattern.replace("/:id", "");
      return path.startsWith(prefix + "/") || path === prefix;
    }
    return pattern === path;
  })?.screen;
  if (screen && LINK_LABELS[screen]) return LINK_LABELS[screen];
  const slug = path.replace(/^\//, "").split("/")[0] ?? "page";
  return `Open ${slug.replace(/-/g, " ")}`;
}

/** Normalize assistant markdown hrefs to safe in-app paths when possible. */
export function normalizeAssistantMarkdownHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const deep = /^vndrly-deep-link:(.+)$/i.exec(trimmed);
  if (deep) {
    const rest = deep[1].trim().replace(/\s+/g, "-").toLowerCase();
    const withId = /^([a-z0-9-]+)[/:](\d+)$/i.exec(rest);
    if (withId) {
      const pattern = SCREEN_PATH[withId[1]];
      if (pattern?.includes(":id")) {
        return pattern.replace(":id", withId[2]);
      }
    }
    const fromScreen = SCREEN_PATH[rest];
    if (fromScreen && !fromScreen.includes(":id") && !fromScreen.includes(":token")) {
      return fromScreen;
    }
    return rest.startsWith("/") ? rest : `/${rest}`;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  }

  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return null;
  }

  const slug = trimmed.replace(/^\.\//, "").split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (SCREEN_PATH[slug] && !SCREEN_PATH[slug].includes(":id") && !SCREEN_PATH[slug].includes(":token")) {
    return SCREEN_PATH[slug];
  }

  if (/^[a-z0-9][a-z0-9-]*(?:\/\d+)?(?:\/[a-z0-9-]+)*$/i.test(trimmed)) {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  return null;
}

export function unwrapBoldMarkdownLinks(text: string): string {
  return text.replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, "[$1]($2)");
}

/** Fix markdown links the model emitted with missing leading slashes or screen slugs. */
export function repairAssistantMarkdownLinks(text: string): string {
  const normalized = unwrapBoldMarkdownLinks(text);
  return normalized.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label: string, href: string) => {
    const fixed = normalizeAssistantMarkdownHref(href);
    return fixed ? `[${label}](${fixed})` : full;
  });
}

function textReferencesUrl(text: string, url: string): boolean {
  if (text.includes(url)) return true;
  const bare = url.replace(/^\//, "");
  return bare.length > 0 && text.includes(bare);
}

type ToolTraceRow = { name: string; output: string };

/** Prepend markdown links for deep_link_to tool results missing from the reply. */
export function ensureDeepLinksInAssistantReply(text: string, toolCalls: ToolTraceRow[]): string {
  let result = repairAssistantMarkdownLinks(text);
  const prefixes: string[] = [];

  for (const call of toolCalls) {
    if (call.name !== "deep_link_to") continue;
    let parsed: { url?: string };
    try {
      parsed = JSON.parse(call.output) as { url?: string };
    } catch {
      continue;
    }
    if (typeof parsed.url !== "string" || !parsed.url.startsWith("/")) continue;
    if (textReferencesUrl(result, parsed.url)) continue;
    prefixes.push(`[${linkLabelForUrl(parsed.url)}](${parsed.url})`);
  }

  if (prefixes.length === 0) return result;
  return `${prefixes.join("\n")}\n\n${result}`;
}
