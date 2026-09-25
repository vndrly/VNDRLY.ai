import { getApiBase } from "@/lib/api";
import { workHubItemDestination, WORK_HUB_MODULE_ALIASES } from "@workspace/api-client-react/work-hub-destinations";

export type AssistantLinkTarget =
  | { type: "route"; path: string }
  | { type: "browser"; url: string };

/** Web routes from api-server `DEEP_LINK_SCREENS` (screen slug → path pattern). */
const WEB_PATH_BY_SCREEN: Record<string, string> = {
  dashboard: "/",
  "onboarding-partner": "/onboarding/partner",
  "onboarding-vendor": "/onboarding/vendor",
  "onboarding-field": "/onboarding/field",
  tickets: "/tickets",
  "ticket-detail": "/tickets/:id",
  "site-locations": "/site-locations",
  "site-location-detail": "/site-locations/:id",
  "field-employees": "/field-employees",
  "field-employee-detail": "/field-employees/:id",
  vendors: "/vendors",
  "vendor-detail": "/vendors/:id",
  partners: "/partners",
  "partner-detail": "/partners/:id",
  invoices: "/invoices",
  "invoice-detail": "/invoices/:id",
  "bills-to-pay": "/bills-to-pay",
  statement: "/statement",
  reports: "/reports",
  "vendor-analytics": "/analytics/vendor/:id",
  "partner-analytics": "/analytics/partner/:id",
  "vendor-catalog": "/vendor-catalog",
  "partner-catalog": "/partner-catalog",
  catalog: "/catalog",
  "catalog-health": "/catalog-health",
  "crew-map": "/crew-map",
  "crew-replay": "/crew-map/:id",
  "site-map": "/site-map",
  visitors: "/visitors",
  "notification-preferences": "/notifications/preferences",
  "notifications-inbox": "/notifications",
  "field-home": "/field",
};

/** Screens that map to an in-app Expo route (no browser handoff). */
const MOBILE_ROUTE_BY_SCREEN: Record<string, string> = {
  dashboard: "/(tabs)",
  tickets: "/history",
  "field-home": "/(tabs)",
  "crew-map": "/(tabs)/crew-map",
  "site-map": "/(tabs)/crew-map",
  "notifications-inbox": "/notifications",
  "notification-preferences": "/notification-preferences",
  "field-employees": "/employees",
  "vendor-catalog": "/services",
  askv: "/(tabs)/askv",
  flagged: "/(tabs)/flagged",
  schedule: "/(tabs)/schedule",
  scan: "/(tabs)/scan",
};

const MOBILE_ROUTE_BY_WEB_PATH: Record<string, string> = {
  "/gate": "/(tabs)/gate",
  "/gate/shift-notes": "/gate/shift-notes",
  "/field/profile": "/(tabs)/profile",
  "/": "/(tabs)",
  "/field": "/(tabs)",
  "/tickets": "/history",
  "/notifications": "/notifications",
  "/notifications/preferences": "/notification-preferences",
  "/field-employees": "/employees",
  "/vendor-catalog": "/services",
  "/crew-map": "/(tabs)/crew-map",
  "/site-map": "/(tabs)/crew-map",
};

function webUrl(path: string): string {
  const base = getApiBase().replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function parsePositiveTicketId(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Extract a ticket id from any href shape AskV might emit. */
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
    if (m) return parsePositiveTicketId(m[1]);
  }

  const pathMatch = trimmed.match(/\/tickets?\/(\d+)/i);
  if (pathMatch) return parsePositiveTicketId(pathMatch[1]);

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const urlMatch = u.pathname.match(/\/tickets?\/(\d+)/i);
      if (urlMatch) return parsePositiveTicketId(urlMatch[1]);
    } catch {
      // ignore
    }
  }

  return null;
}

function ticketRoute(id: number): AssistantLinkTarget {
  return { type: "route", path: `/ticket/${id}` };
}

function resolveScreenSlug(screen: string, id?: string): AssistantLinkTarget | null {
  const slug = screen.trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug) return null;
  if (slug === "work-hub") return { type: "route", path: "/(tabs)/work-hub" };
  if (slug.startsWith("work-hub-")) {
    const module = WORK_HUB_MODULE_ALIASES[slug.slice(9)];
    return module ? { type: "route", path: `/work-hub/${module.native}${module.web === "assets" ? "?section=inventory" : ""}` } : null;
  }
  if (slug === "shift-notes") return { type: "route", path: "/gate/shift-notes" };
  if (slug === "profile") return { type: "route", path: "/(tabs)/profile" };
  if (slug === "gate") return { type: "route", path: "/(tabs)/gate" };

  if (slug === "ticket-detail" || slug === "tickets") {
    if (id) return ticketRoute(Number(id));
    return { type: "route", path: "/history" };
  }
  if (slug === "invoice-detail" && id) {
    return { type: "route", path: `/invoice/${id}` };
  }
  if (slug === "crew-replay" && id) {
    return { type: "route", path: `/crew-replay/${id}` };
  }

  const mobile = MOBILE_ROUTE_BY_SCREEN[slug];
  if (mobile) return { type: "route", path: mobile };

  const pattern = WEB_PATH_BY_SCREEN[slug];
  if (pattern) {
    if (pattern.includes(":id") && id) {
      const webPath = pattern.replace(":id", id);
      const ticketId = parseTicketIdFromHref(webPath);
      if (ticketId !== null) return ticketRoute(ticketId);
    }
    let path = pattern;
    if (path.includes(":id") && id) {
      path = path.replace(":id", id);
    } else if (path.includes(":id")) {
      return { type: "browser", url: webUrl(path.replace("/:id", "")) };
    }
    return { type: "browser", url: webUrl(path) };
  }

  return { type: "browser", url: webUrl(`/${slug}`) };
}

function resolveWebPath(pathAndQuery: string): AssistantLinkTarget | null {
  const trimmed = pathAndQuery.trim();
  if (!trimmed.startsWith("/")) return null;

  const ticketId = parseTicketIdFromHref(trimmed);
  if (ticketId !== null) return ticketRoute(ticketId);

  const pathOnly = trimmed.split(/[?#]/)[0] ?? trimmed;
  if (pathOnly === "/work-hub") return { type: "route", path: "/(tabs)/work-hub" };
  if (pathOnly.startsWith("/work-hub/")) {
    const params = new URLSearchParams(trimmed.split("?")[1] ?? "");
    const item = params.get("item") ?? params.get("assetId");
    if (item) {
      const destination = workHubItemDestination(params.has("assetId") ? "asset" : params.get("type") ?? "", item);
      return destination ? { type: "route", path: destination.nativePath } : null;
    }
    const module = WORK_HUB_MODULE_ALIASES[pathOnly.slice(10)];
    if (!module) return null;
    if (module.web === "assets") params.set("section", "inventory");
    return { type: "route", path: `/work-hub/${module.native}${params.size ? `?${params}` : ""}` };
  }
  const mobile = MOBILE_ROUTE_BY_WEB_PATH[pathOnly];
  if (mobile) return { type: "route", path: mobile };

  return { type: "browser", url: webUrl(trimmed) };
}

function resolveAbsoluteUrl(href: string): AssistantLinkTarget | null {
  const ticketId = parseTicketIdFromHref(href);
  if (ticketId !== null) return ticketRoute(ticketId);

  try {
    const url = new URL(href);
    const base = new URL(getApiBase());
    if (url.hostname === base.hostname || url.hostname === "localhost") {
      return resolveWebPath(`${url.pathname}${url.search}`);
    }
    return { type: "browser", url: href };
  } catch {
    return null;
  }
}

/** Resolve assistant markdown hrefs to in-app navigation or a web fallback. */
export function resolveAssistantLink(href: string): AssistantLinkTarget | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const ticketId = parseTicketIdFromHref(trimmed);
  if (ticketId !== null) return ticketRoute(ticketId);

  const deepLinkMatch = /^vndrly-deep-link:(.+)$/i.exec(trimmed);
  if (deepLinkMatch) {
    const rest = deepLinkMatch[1].trim();
    const withId = /^([a-z0-9-]+)[/:](\d+)$/i.exec(rest);
    if (withId) {
      return resolveScreenSlug(withId[1], withId[2]);
    }
    return resolveScreenSlug(rest);
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return resolveWebPath(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return resolveAbsoluteUrl(trimmed);
  }

  return null;
}
