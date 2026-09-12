/**
 * Public-source Flywheel Energy onboarding fill-in.
 *
 * Every field here is taken from Flywheel's own website or from a
 * published owner-relations FAQ. Nothing in this module invents a
 * password, tax ID, personal email, hours of operation, or legal
 * acceptance — those remain for a Flywheel admin to complete in the
 * /onboarding/partner wizard.
 *
 * Sources (retrieved 2026-08-25):
 *   https://flywheelenergy.com/
 *   https://www.flywheelenergy.com/about
 *   https://www.flywheelenergy.com/leadership
 *   https://www.flywheelenergy.com/contact
 *   https://www.flywheelenergy.com/owners
 *   Flywheel Energy FAQ (owner relations mail/phone, HQ suite)
 */

export const FLYWHEEL_DISPLAY_NAME = "Flywheel Energy";
export const FLYWHEEL_LEGAL_NAME = "Flywheel Energy, LLC";

/** Names we treat as the same org when looking up an existing partner row. */
export const FLYWHEEL_NAME_ALIASES = [
  FLYWHEEL_DISPLAY_NAME,
  FLYWHEEL_LEGAL_NAME,
  "Flywheel Energy Production, LLC",
  "Flywheel Energy Production",
] as const;

/** Live gate default from artifacts/vndrly/src/lib/gate-default-site.ts. */
export const FLYWHEEL_SPUR_SITE_CODE = "SITE-B40D77D2";

const HQ_ADDRESS = "621 N. Robinson Ave., Suite 300, Oklahoma City, OK 73102";

export const FLYWHEEL_PUBLIC_PROFILE = {
  name: FLYWHEEL_DISPLAY_NAME,
  contactName: "Justin Cope",
  contactEmail: "info@flywheelenergy.com",
  contactPhone: "(405) 702-6991",
  businessPhone: "(405) 702-6991",
  physicalAddress: HQ_ADDRESS,
  billingAddress: HQ_ADDRESS,
  blurb:
    "Flywheel Energy is a private exploration and production company dedicated to providing American consumers with reliable, affordable energy by acquiring and efficiently operating large, producing onshore U.S. oil and gas assets. Founded in 2017 and headquartered in Oklahoma City, it is an operating partner of Stone Ridge Energy.",
  // Squarespace theme tokens from flywheelenergy.com (primary blue + navy).
  brandPrimaryColor: "#3374C1",
  brandAccentColor: "#121F43",
} as const;

export type FlywheelPublicContact = {
  jobTitle: string;
  name: string;
  email: string;
  phone: string | null;
  roles: string[];
};

export const FLYWHEEL_PUBLIC_CONTACTS: FlywheelPublicContact[] = [
  {
    jobTitle: "General inquiries",
    name: "Flywheel Energy",
    email: "info@flywheelenergy.com",
    phone: "(405) 702-6991",
    roles: [],
  },
  {
    jobTitle: "Owner Relations",
    name: "Owner Relations",
    email: "ownerrelations@flywheelenergy.com",
    phone: "(833) 604-8136",
    roles: [],
  },
  {
    jobTitle: "Accounts Payable",
    name: "Accounts Payable",
    email: "accountspayable@flywheelenergy.com",
    phone: null,
    roles: ["ap"],
  },
];

type Blankish = string | number | null | undefined;

function isBlank(value: Blankish): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function isPlaceholderContactName(
  contactName: Blankish,
  orgName: string,
): boolean {
  if (isBlank(contactName)) return true;
  const contact = String(contactName).trim().toLowerCase();
  const org = orgName.trim().toLowerCase();
  if (contact === org) return true;
  return FLYWHEEL_NAME_ALIASES.some((alias) => alias.toLowerCase() === contact);
}

export type PartnerPublicFields = {
  name?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  businessPhone?: string | null;
  physicalAddress?: string | null;
  billingAddress?: string | null;
  hoursOfOperation?: string | null;
  blurb?: string | null;
  operatingRadiusMiles?: number | null;
  federalTaxId?: string | null;
  stateTaxId?: string | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
  logoUrl?: string | null;
  logoSquareUrl?: string | null;
};

const PARTNER_FILL_KEYS = [
  "contactPhone",
  "businessPhone",
  "physicalAddress",
  "billingAddress",
  "blurb",
  "brandPrimaryColor",
  "brandAccentColor",
] as const;

export function buildPartnerPatch(
  existing: PartnerPublicFields,
): Partial<typeof FLYWHEEL_PUBLIC_PROFILE> {
  const patch: Record<string, string> = {};
  const orgName = existing.name?.trim() || FLYWHEEL_DISPLAY_NAME;

  if (isPlaceholderContactName(existing.contactName, orgName)) {
    patch.contactName = FLYWHEEL_PUBLIC_PROFILE.contactName;
  }
  if (isBlank(existing.contactEmail)) {
    patch.contactEmail = FLYWHEEL_PUBLIC_PROFILE.contactEmail;
  }
  for (const key of PARTNER_FILL_KEYS) {
    if (isBlank(existing[key])) {
      patch[key] = FLYWHEEL_PUBLIC_PROFILE[key];
    }
  }
  return patch;
}

export type OnboardingFirstSite = {
  name?: string;
  address?: string;
  siteCode?: string;
  siteRadiusMeters?: number;
};

export type OnboardingTaxBilling = {
  federalTaxId?: string;
  stateTaxId?: string;
  physicalAddress?: string;
  billingAddress?: string;
};

export type PartnerOnboardingPayload = {
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  logoUrl?: string;
  logoSquareUrl?: string;
  firstSite?: OnboardingFirstSite;
  taxBilling?: OnboardingTaxBilling;
  inviteEmails?: string[];
  platformEula?: { accepted?: boolean; version?: string };
  legalConsent?: { accepted?: boolean; smsOptIn?: boolean; version?: string };
  [key: string]: unknown;
};

function mergeObjectBlanks<T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: T,
): T {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === "") continue;
    if (isBlank(out[key] as Blankish)) out[key] = value;
  }
  return out as T;
}

export function buildOnboardingPayload(args: {
  existingPayload: PartnerOnboardingPayload;
  partner: Pick<
    PartnerPublicFields,
    | "brandPrimaryColor"
    | "brandAccentColor"
    | "logoUrl"
    | "logoSquareUrl"
    | "physicalAddress"
    | "billingAddress"
  >;
  firstSite?: OnboardingFirstSite | null;
}): PartnerOnboardingPayload {
  const existing = args.existingPayload ?? {};
  const next: PartnerOnboardingPayload = { ...existing };

  const siteIncoming = args.firstSite
    ? {
        name: args.firstSite.name,
        address: args.firstSite.address,
        siteCode: args.firstSite.siteCode,
        siteRadiusMeters: args.firstSite.siteRadiusMeters,
      }
    : undefined;
  if (siteIncoming) {
    next.firstSite = mergeObjectBlanks(existing.firstSite, siteIncoming);
  }

  next.taxBilling = mergeObjectBlanks(existing.taxBilling, {
    physicalAddress:
      args.partner.physicalAddress?.trim() ||
      FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
    billingAddress:
      args.partner.billingAddress?.trim() ||
      FLYWHEEL_PUBLIC_PROFILE.billingAddress,
  });

  if (isBlank(existing.brandPrimaryColor) && args.partner.brandPrimaryColor) {
    next.brandPrimaryColor = args.partner.brandPrimaryColor;
  }
  if (isBlank(existing.brandAccentColor) && args.partner.brandAccentColor) {
    next.brandAccentColor = args.partner.brandAccentColor;
  }
  if (isBlank(existing.logoUrl) && args.partner.logoUrl) {
    next.logoUrl = args.partner.logoUrl;
  }
  if (isBlank(existing.logoSquareUrl) && args.partner.logoSquareUrl) {
    next.logoSquareUrl = args.partner.logoSquareUrl;
  }

  if (!Array.isArray(existing.inviteEmails) || existing.inviteEmails.length === 0) {
    next.inviteEmails = FLYWHEEL_PUBLIC_CONTACTS.map((c) => c.email);
  }

  // Public sources cannot accept legal terms or invent tax IDs.
  // Keep whatever the wizard already stored; never introduce these keys.
  return next;
}
