import type { SignupAssistantLang } from "@/hooks/use-assistant";

/** Derive askV page context from the current wouter path. */
export function parseAssistantPageContext(path: string): {
  path: string;
  entityId?: number;
} {
  const normalized = path.split("?")[0] || "/";
  const idMatch = normalized.match(/\/(\d+)(?:\/|$)/);
  const entityId = idMatch ? Number(idMatch[1]) : undefined;
  return entityId != null && Number.isFinite(entityId)
    ? { path: normalized, entityId }
    : { path: normalized };
}

/**
 * Pick the initial signup-mode language from the visitor's browser.
 * Anything that starts with "es" (es, es-MX, es-US, es-ES, ...) → "es";
 * everything else → "en".
 */
export function detectSignupBrowserLanguage(
  navigatorLike?: { language?: string; languages?: readonly string[] },
): SignupAssistantLang {
  const nav: { language?: string; languages?: readonly string[] } | undefined =
    navigatorLike ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!nav) return "en";
  const candidates: string[] = [];
  if (Array.isArray(nav.languages)) candidates.push(...nav.languages);
  if (typeof nav.language === "string") candidates.push(nav.language);
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    if (raw.toLowerCase().startsWith("es")) return "es";
  }
  return "en";
}
