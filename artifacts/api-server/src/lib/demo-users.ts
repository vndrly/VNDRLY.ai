// Single source of truth for demo accounts.
//
// These accounts are seeded in development by `POST /api/auth/seed` and
// surfaced to the web/mobile login screens via `GET /api/auth/demo-users`
// (also dev-only) so the demo-account panel stays in sync with what
// actually exists on the server.

export type DemoUserRole = "admin" | "partner" | "vendor" | "field_employee";

export type DemoLocale = "en" | "es";

export interface DemoMembership {
  orgType: "partner" | "vendor";
  orgId: number;
  /** In-org role: admin (full org control), member (regular access), ap, field_employee. */
  role: "admin" | "member" | "ap" | "field_employee";
}

export interface DemoUser {
  username: string;
  password: string;
  role: DemoUserRole;
  displayName: string;
  /**
   * Short label shown in the demo-account picker, per supported locale.
   * The `en` label doubles as the canonical fallback when an unknown
   * locale is requested.
   */
  labels: Record<DemoLocale, string>;
  partnerId: number | null;
  vendorId: number | null;
  preferredLanguage?: "en" | "es" | null;
  /**
   * Optional explicit membership list. When omitted the seeder derives a
   * single membership from `partnerId`/`vendorId` + `role`. Use this to
   * give a demo user multiple memberships (the dual-role demo).
   */
  memberships?: DemoMembership[];
}

export const DEMO_USERS: DemoUser[] = [
  {
    username: "admin",
    password: "winchester2",
    role: "admin",
    displayName: "System Admin",
    labels: { en: "System Admin", es: "Administrador del Sistema" },
    partnerId: null,
    vendorId: null,
  },
  {
    username: "exxon",
    password: "winchester2",
    role: "partner",
    displayName: "ExxonMobil User",
    labels: { en: "ExxonMobil", es: "ExxonMobil" },
    partnerId: 1,
    vendorId: null,
  },
  {
    username: "exxon.ops",
    password: "winchester2",
    role: "partner",
    displayName: "ExxonMobil Ops Approver",
    labels: { en: "ExxonMobil Ops Approver", es: "Aprobador de Operaciones ExxonMobil" },
    partnerId: null,
    vendorId: null,
    memberships: [{ orgType: "partner", orgId: 1, role: "member" }],
  },
  {
    username: "exxon.ap",
    password: "winchester2",
    role: "partner",
    displayName: "ExxonMobil AP Approver",
    labels: { en: "ExxonMobil AP Approver", es: "Aprobador AP ExxonMobil" },
    partnerId: null,
    vendorId: null,
    memberships: [{ orgType: "partner", orgId: 1, role: "ap" }],
  },
  {
    username: "exxon.finance",
    password: "winchester2",
    role: "partner",
    displayName: "ExxonMobil Finance Approver",
    labels: { en: "ExxonMobil Finance Approver", es: "Aprobador de Finanzas ExxonMobil" },
    partnerId: null,
    vendorId: null,
    memberships: [{ orgType: "partner", orgId: 1, role: "ap" }],
  },
  {
    username: "chevron",
    password: "winchester2",
    role: "partner",
    displayName: "Chevron User",
    labels: { en: "Chevron", es: "Chevron" },
    partnerId: 2,
    vendorId: null,
  },
  {
    username: "shell",
    password: "winchester2",
    role: "partner",
    displayName: "Shell User",
    labels: { en: "Shell", es: "Shell" },
    partnerId: 3,
    vendorId: null,
  },
  {
    username: "marathon",
    password: "winchester2",
    role: "partner",
    displayName: "Marathon User",
    labels: { en: "Marathon", es: "Marathon" },
    partnerId: 4,
    vendorId: null,
  },
  {
    username: "bp",
    password: "winchester2",
    role: "partner",
    displayName: "BP User",
    labels: { en: "BP", es: "BP" },
    partnerId: 6,
    vendorId: null,
  },
  {
    username: "precision",
    password: "winchester2",
    role: "vendor",
    displayName: "Precision Drilling User",
    labels: { en: "Precision Drilling", es: "Precision Drilling" },
    partnerId: null,
    vendorId: 1,
  },
  // Demo prep — short, easy-to-remember admin logins for the three orgs the
  // demo runs through. The long-email logins (winchester@vndrly.com,
  // mach@vndrly.com) still exist; these are just shorter aliases.
  {
    username: "winchester",
    password: "winchester2",
    role: "vendor",
    displayName: "Winchester User",
    labels: { en: "Winchester", es: "Winchester" },
    partnerId: null,
    vendorId: 3,
  },
  {
    username: "baker",
    password: "winchester2",
    role: "vendor",
    displayName: "Baker Hughes Field Svcs User",
    labels: { en: "Baker Hughes Field Svcs", es: "Baker Hughes Field Svcs" },
    partnerId: null,
    vendorId: 2,
  },
  {
    username: "mach",
    password: "winchester2",
    role: "partner",
    displayName: "Mach Natural Resources User",
    labels: { en: "Mach Natural Resources", es: "Mach Natural Resources" },
    partnerId: 19,
    vendorId: null,
  },
  // Dual-role demo: this user is both a partner admin (ExxonMobil) and a
  // vendor admin (Precision Drilling) so the demo can show the in-app
  // context switcher live. The single-org `partnerId`/`vendorId` fields
  // are intentionally null — context is resolved entirely from the
  // explicit `memberships` list below.
  {
    username: "tristan",
    password: "winchester2",
    role: "partner",
    displayName: "Tristan (Dual Role Demo)",
    labels: { en: "Tristan (Dual Role)", es: "Tristan (Doble Rol)" },
    partnerId: null,
    vendorId: null,
    memberships: [
      { orgType: "partner", orgId: 1, role: "admin" },
      { orgType: "vendor", orgId: 1, role: "admin" },
    ],
  },
];

/**
 * Supported demo-account locales, in display order. Source of truth
 * for both the runtime locale resolver below and the admin UI that
 * renders one editable label column per locale. Add a new locale
 * here and the admin editor will automatically grow a column for it
 * — no other code changes required.
 */
export const DEMO_LOCALES: readonly DemoLocale[] = ["en", "es"] as const;

const SUPPORTED_LOCALES: ReadonlySet<DemoLocale> = new Set(DEMO_LOCALES);

/**
 * Resolve a requested locale to one we have translations for.
 * Accepts a raw `?lang=` query value or a single Accept-Language header
 * value (e.g. "es-MX,es;q=0.9"). Falls back to "en".
 */
export function resolveDemoLocale(
  rawLang: string | undefined | null,
  acceptLanguage: string | undefined | null,
): DemoLocale {
  const fromQuery = pickLocale(rawLang);
  if (fromQuery) return fromQuery;
  if (acceptLanguage) {
    const tags = acceptLanguage
      .split(",")
      .map((part) => part.trim().split(";")[0]?.trim())
      .filter(Boolean) as string[];
    for (const tag of tags) {
      const match = pickLocale(tag);
      if (match) return match;
    }
  }
  return "en";
}

function pickLocale(value: string | undefined | null): DemoLocale | null {
  if (!value) return null;
  const base = value.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.has(base as DemoLocale) ? (base as DemoLocale) : null;
}
