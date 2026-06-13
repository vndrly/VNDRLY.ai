// Pure permission helpers extracted from routes/assistant.ts so the
// regression test catalog can exercise the same role-gate logic the
// production assistant runtime uses, with zero drift.
//
// Two responsibilities live here:
//   1. ROLE_ALLOWED_SCREENS — which deep-link screens each caller role
//      may navigate to. `null` means "no gate" (admin / unknown role).
//      The route handler reads this map directly.
//   2. clampMetricsDays — clamps the `?days=` query param on
//      /assistant/metrics into a sane integer range. Pulled out so a
//      unit test can assert "max 90, min 1, default 7, NaN -> 7"
//      without spinning up the express app.

export type AssistantRole = "admin" | "partner" | "vendor" | "field_employee" | "any";

export const ROLE_ALLOWED_SCREENS: Record<AssistantRole, Set<string> | null> = {
  admin: null,
  partner: new Set([
    "dashboard",
    "onboarding-partner",
    "tickets",
    "ticket-detail",
    "site-locations",
    "site-location-detail",
    "partners",
    "partner-detail",
    "site-map",
    "visitors",
    "bills-to-pay",
    "statement",
    "reports",
    "partner-analytics",
    "partner-catalog",
    "notification-preferences",
    "notifications-inbox",
  ]),
  vendor: new Set([
    "dashboard",
    "onboarding-vendor",
    "tickets",
    "ticket-detail",
    "site-locations",
    "site-location-detail",
    "field-employees",
    "field-employee-detail",
    "vendors",
    "vendor-detail",
    "crew-map",
    "crew-replay",
    "visitors",
    "invoices",
    "invoice-detail",
    "statement",
    "reports",
    "vendor-analytics",
    "vendor-catalog",
    "catalog",
    "notification-preferences",
    "notifications-inbox",
  ]),
  field_employee: new Set([
    "onboarding-field",
    "field-home",
    "ticket-detail",
  ]),
  any: null,
};

export type DeepLinkGateResult = { ok: true } | { ok: false; error: string };

// Decide whether `role` may navigate to `screen`. Mirrors the gate in
// the deep_link_to tool case so a regression test can call the exact
// same function the runtime uses.
export function gateDeepLinkScreen(role: AssistantRole, screen: string): DeepLinkGateResult {
  const allowed = ROLE_ALLOWED_SCREENS[role];
  if (!allowed) return { ok: true };
  if (allowed.has(screen)) return { ok: true };
  return {
    ok: false,
    error: `The '${screen}' screen isn't available to ${
      role === "any" ? "your role" : role + "s"
    } in this app. Suggest a different screen or coach the user another way.`,
  };
}

// /assistant/metrics?days=… clamp. Default 7, max 90, min 1; NaN /
// non-numeric / non-positive falls back to 7. Floor first, then
// clamp into [1, 90] so fractional inputs like 0.5 don't slip
// through as a zero-day range.
export function clampMetricsDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 7;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  return Math.min(90, floored);
}
