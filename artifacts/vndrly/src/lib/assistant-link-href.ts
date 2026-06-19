/** Screen slug → web route (subset of api-server DEEP_LINK_SCREENS). */
const SCREEN_PATH: Record<string, string> = {
  dashboard: "/",
  "bills-to-pay": "/bills-to-pay",
  invoices: "/invoices",
  reports: "/reports",
  tickets: "/tickets",
  statement: "/statement",
  "site-locations": "/site-locations",
  "field-employees": "/field-employees",
  vendors: "/vendors",
  partners: "/partners",
  "vendor-catalog": "/vendor-catalog",
  "partner-catalog": "/partner-catalog",
  catalog: "/catalog",
  "crew-map": "/crew-map",
  "site-map": "/site-map",
  visitors: "/visitors",
  notifications: "/notifications",
  "notification-preferences": "/notifications/preferences",
};

export function unwrapBoldMarkdownLinks(text: string): string {
  return text.replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, "[$1]($2)");
}

export function normalizeAssistantMarkdownInput(text: string): string {
  return unwrapBoldMarkdownLinks(
    text
      .replace(/\uFF3B/g, "[")
      .replace(/\uFF3D/g, "]")
      .replace(/\uFF08/g, "(")
      .replace(/\uFF09/g, ")")
      .replace(/\\([\[\]()])/g, "$1")
      .replace(/\]\s+\(/g, "]("),
  );
}

/** Turn model-emitted hrefs into safe in-app paths for wouter <Link>. */
export function normalizeAssistantLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const deep = /^vndrly-deep-link:(.+)$/i.exec(trimmed);
  if (deep) {
    const rest = deep[1].trim().replace(/\s+/g, "-").toLowerCase();
    const withId = /^([a-z0-9-]+)[/:](\d+)$/i.exec(rest);
    if (withId) {
      const pattern = SCREEN_PATH[withId[1]];
      if (pattern === "/tickets") return `/tickets/${withId[2]}`;
      if (pattern?.includes(":id")) return pattern.replace(":id", withId[2]);
    }
    const fromScreen = SCREEN_PATH[rest];
    if (fromScreen) return fromScreen;
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
  if (SCREEN_PATH[slug]) return SCREEN_PATH[slug];

  if (/^[a-z0-9][a-z0-9-]*(?:\/\d+)?(?:\/[a-z0-9-]+)*$/i.test(trimmed)) {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  return null;
}
