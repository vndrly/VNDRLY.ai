/** Existing embedded routes and their Expo Router counterparts. */
export type EmbeddedPagePath = "/gate" | "/gate/change-over" | "/gate/map" | "/gate/history" | "/gate/shift-notes" | "/gate/header" | "/personal-agreements" | "/admin/billing-payroll" | "/admin/import-export" | "/work-hub" | `/work-hub/${string}`;

export function embeddedPageRoute(href: unknown): string | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  const url = new URL(href, "https://embedded.invalid");
  const routes: Record<string, string> = { "/gate": "/gate", "/gate/change-over": "/change-over", "/gate/map": "/gate-map", "/gate/history": "/gate-history", "/gate/shift-notes": "/shift-notes" };
  const path = routes[url.pathname] ?? (/^\/work-hub(?:\/|$)/.test(url.pathname) ? url.pathname : null);
  if (!path) return null;
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("gate") && !["gateId"].includes(key)) url.searchParams.delete(key);
  return path + url.search + url.hash;
}
