// Single source of truth for the assistant's URL-to-screen map.
//
// Two consumers read from this module so they can never drift apart:
//   1. The runtime `buildDeepLink` (re-exported below) used by the
//      `deep_link_to` tool case in routes/assistant.ts. It turns a
//      structured tool input ({ screen, id, token, step, reportCard, … })
//      into a concrete URL string the UI can navigate to.
//   2. The role-gating lint in artifacts/vndrly/tests/assistant.spec.ts,
//      which derives `URL_TO_SCREEN` (route pattern → screen name) from
//      `DEEP_LINK_SCREENS` so every URL the lint sees is paired with
//      the same screen name `gateDeepLinkScreen` checks against.
//
// Adding a new screen here automatically:
//   - lets `buildDeepLink` resolve it,
//   - feeds the role-gating lint so it can't silently skip the URL.
//
// Paths are verified against the router in
// artifacts/vndrly/src/App.tsx — keep in sync when routes are added or
// renamed (the test "URL_TO_SCREEN keys all parse as known App.tsx
// routes" is the canary if you forget).

import {
  resolvePeriod,
  PERIOD_PRESETS,
  type Period,
  type PeriodPreset,
} from "../lib/reports/period";

export type DeepLinkInput = {
  screen: string;
  id?: number;
  token?: string;
  step?: string;
  /** Reports page card id — must be in REPORT_CARD_IDS. */
  reportCard?: string;
  /** Period preset for report deep links (defaults to ytd). */
  reportPreset?: string;
  /** Optional row highlight for salesTaxByState (e.g. TX). */
  highlightState?: string;
};

/** Report cards that support `?card=&periodStart=&periodEnd=` deep links. */
export const REPORT_CARD_IDS = [
  "salesTaxByState",
  "accountingExport",
] as const;
export type ReportCardId = (typeof REPORT_CARD_IDS)[number];

const REPORT_CARD_SET = new Set<string>(REPORT_CARD_IDS);

function utcDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive [start, end] date strings for ReportsPage URL params. */
export function periodToReportUrlRange(period: Period): { periodStart: string; periodEnd: string } {
  const inclusiveEnd = new Date(period.end.getTime() - 1);
  return { periodStart: utcDateOnly(period.start), periodEnd: utcDateOnly(inclusiveEnd) };
}

function appendQuery(url: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${url}?${qs}` : url;
}

export type DeepLinkScreenDef = {
  // The screen name the `deep_link_to` tool accepts on the wire and
  // the same string `ROLE_ALLOWED_SCREENS` in permissions.ts gates on.
  screen: string;
  // Route pattern matching what App.tsx registers, with `:id` /
  // `:token` placeholders where applicable. The role-gating lint maps
  // doc URLs back to a screen via this pattern, so it must literally
  // match what App.tsx exposes.
  pattern: string;
  // True if the screen is a detail page that requires a numeric id.
  // `buildDeepLink` returns an error when the id is missing.
  requiresId?: boolean;
  // True if the screen is the token-bound field-employee invite page.
  // `buildDeepLink` returns an error when the token is missing.
  requiresToken?: boolean;
  // True for screens that accept the optional `?step=` query (the
  // partner and vendor onboarding wizards). Anything else silently
  // ignores `step` to preserve the historical behaviour of the switch
  // this module replaces.
  supportsStepQuery?: boolean;
};

export const DEEP_LINK_SCREENS: ReadonlyArray<DeepLinkScreenDef> = [
  // The dashboard route is the root path "/" for authenticated
  // non-field users; "/dashboard" does not exist.
  { screen: "dashboard", pattern: "/" },
  { screen: "onboarding-partner", pattern: "/onboarding/partner", supportsStepQuery: true },
  { screen: "onboarding-vendor", pattern: "/onboarding/vendor", supportsStepQuery: true },
  // Token-bound invite URL — the field employee gets it in their
  // email. Without the token there is no valid landing page.
  { screen: "onboarding-field", pattern: "/onboarding/field/:token", requiresToken: true },
  { screen: "tickets", pattern: "/tickets" },
  { screen: "ticket-detail", pattern: "/tickets/:id", requiresId: true },
  { screen: "site-locations", pattern: "/site-locations" },
  { screen: "site-location-detail", pattern: "/site-locations/:id", requiresId: true },
  { screen: "field-employees", pattern: "/field-employees" },
  { screen: "field-employee-detail", pattern: "/field-employees/:id", requiresId: true },
  { screen: "vendors", pattern: "/vendors" },
  { screen: "vendor-detail", pattern: "/vendors/:id", requiresId: true },
  { screen: "partners", pattern: "/partners" },
  { screen: "partner-detail", pattern: "/partners/:id", requiresId: true },
  { screen: "invoices", pattern: "/invoices" },
  { screen: "invoice-detail", pattern: "/invoices/:id", requiresId: true },
  { screen: "bills-to-pay", pattern: "/bills-to-pay" },
  { screen: "statement", pattern: "/statement" },
  { screen: "reports", pattern: "/reports" },
  { screen: "vendor-analytics", pattern: "/analytics/vendor/:id", requiresId: true },
  { screen: "partner-analytics", pattern: "/analytics/partner/:id", requiresId: true },
  { screen: "vendor-catalog", pattern: "/vendor-catalog" },
  { screen: "partner-catalog", pattern: "/partner-catalog" },
  { screen: "catalog", pattern: "/catalog" },
  { screen: "catalog-health", pattern: "/catalog-health" },
  { screen: "crew-map", pattern: "/crew-map" },
  { screen: "crew-replay", pattern: "/crew-map/:id", requiresId: true },
  { screen: "site-map", pattern: "/site-map" },
  { screen: "visitors", pattern: "/visitors" },
  { screen: "notification-preferences", pattern: "/notifications/preferences" },
  { screen: "notifications-inbox", pattern: "/notifications" },
  { screen: "field-home", pattern: "/field" },
];

// Lookup from screen name → definition. Built once at module load.
const SCREEN_BY_NAME: ReadonlyMap<string, DeepLinkScreenDef> = new Map(
  DEEP_LINK_SCREENS.map((d) => [d.screen, d]),
);

// Lookup from route pattern → screen name. The role-gating lint in
// the vndrly test suite imports this to check that every doc URL it
// resolves to a known pattern also resolves to a screen with a
// concrete role gate.
export const URL_PATTERN_TO_SCREEN: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEEP_LINK_SCREENS.map((d) => [d.pattern, d.screen])),
);

// Build the deep-link target from the structured tool input. Returns
// either a string URL on success, or `{ error: string }` if a detail
// screen was requested without the required id/token. The caller
// serialises either shape as JSON for the model.
export function buildDeepLink(
  input: DeepLinkInput,
): string | { error: string } {
  const def = SCREEN_BY_NAME.get(input.screen);
  if (!def) return { error: `Unknown screen: ${input.screen}` };

  if (def.requiresId) {
    if (typeof input.id !== "number" || !Number.isFinite(input.id)) {
      return {
        error: `${def.screen} requires an id. Ask the user which one or look it up first.`,
      };
    }
  }
  if (def.requiresToken) {
    if (!input.token) {
      return {
        error: "Field-employee onboarding requires the invite token from the email link.",
      };
    }
  }

  let url = def.pattern;
  if (def.requiresId && typeof input.id === "number") {
    url = url.replace(":id", String(input.id));
  }
  if (def.requiresToken && input.token) {
    url = url.replace(":token", encodeURIComponent(input.token));
  }

  const query: Record<string, string> = {};
  if (def.supportsStepQuery && input.step) {
    query.step = input.step;
  }
  if (input.screen === "reports" && input.reportCard) {
    if (!REPORT_CARD_SET.has(input.reportCard)) {
      return {
        error: `Unknown report card '${input.reportCard}'. Allowed: ${REPORT_CARD_IDS.join(", ")}.`,
      };
    }
    const presetRaw = typeof input.reportPreset === "string" ? input.reportPreset : "ytd";
    const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw)
      ? (presetRaw as PeriodPreset)
      : "ytd";
    const range = periodToReportUrlRange(resolvePeriod({ preset }));
    query.card = input.reportCard;
    query.periodStart = range.periodStart;
    query.periodEnd = range.periodEnd;
    if (typeof input.highlightState === "string" && input.highlightState.trim()) {
      query.state = input.highlightState.trim().toUpperCase();
    }
  }

  if (Object.keys(query).length > 0) {
    url = appendQuery(url, query);
  }
  return url;
}
