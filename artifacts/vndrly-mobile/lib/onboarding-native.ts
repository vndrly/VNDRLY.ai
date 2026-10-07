import { LEGAL_POLICY_VERSION } from "@workspace/api-zod";
import { PLATFORM_EULA_VERSION } from "../../../lib/platform-eula/src/index";
export type OnboardingPersona = "partner" | "vendor" | "field_employee";
export type NativeOnboardingProgress = {
  id: number;
  orgType: OnboardingPersona;
  partnerId?: number | null;
  vendorId?: number | null;
  currentStep: string;
  completedSteps: string[];
  skippedSteps: string[];
  payload: Record<string, any>;
  completedAt?: string | null;
};
export const ONBOARDING_STEPS: Record<OnboardingPersona, string[]> = {
  partner: [
    "company-basics",
    "platform-eula",
    "legal-consent",
    "branding",
    "first-site",
    "tax-billing",
    "preferences",
    "invite-team",
  ],
  vendor: [
    "company-basics",
    "platform-eula",
    "legal-consent",
    "branding",
    "tax-ids",
    "work-types",
    "first-employee",
  ],
  field_employee: ["personal-info", "photo-certs", "set-password"],
};
export const DEFERABLE_ONBOARDING: Record<OnboardingPersona, string[]> = {
  partner: [
    "branding",
    "first-site",
    "tax-billing",
    "preferences",
    "invite-team",
  ],
  vendor: ["branding", "tax-ids", "work-types", "first-employee"],
  field_employee: [],
};
export const ONBOARDING_FIELDS: Record<string, string[]> = {
  "personal-info": ["info.firstName", "info.lastName", "info.phone"],
  "photo-certs": ["pec.expirationDate"],
  "first-site": [
    "firstSite.name",
    "firstSite.address",
    "firstSite.siteCode",
    "firstSite.siteRadiusMeters",
  ],
  "tax-billing": [
    "taxBilling.federalTaxId",
    "taxBilling.stateTaxId",
    "taxBilling.physicalAddress",
    "taxBilling.billingAddress",
  ],
  "tax-ids": [
    "taxIds.federalTaxId",
    "taxIds.stateTaxId",
    "taxIds.physicalAddress",
    "taxIds.billingAddress",
  ],
  "work-types": ["serviceArea.operatingRadiusMiles"],
  "first-employee": [
    "firstEmployee.firstName",
    "firstEmployee.lastName",
    "firstEmployee.email",
    "firstEmployee.phone",
  ],
  preferences: [
    "preferences.hoursOfOperation",
    "preferences.operatingRadiusMiles",
  ],
};
export function onboardingValue(
  payload: Record<string, any>,
  path: string,
): any {
  return path.split(".").reduce((value, key) => value?.[key], payload);
}
export function setOnboardingValue(
  payload: Record<string, any>,
  path: string,
  value: unknown,
): Record<string, any> {
  const copy = { ...payload },
    parts = path.split(".");
  let node = copy;
  for (const key of parts.slice(0, -1))
    node = node[key] = { ...(node[key] ?? {}) };
  node[parts.at(-1)!] = value;
  return copy;
}
export function onboardingTransition(
  persona: OnboardingPersona,
  current: string,
  defer: boolean,
): string {
  if (defer && !DEFERABLE_ONBOARDING[persona].includes(current))
    throw new Error("This section cannot be deferred");
  const steps = ONBOARDING_STEPS[persona],
    index = steps.indexOf(current);
  if (index < 0) throw new Error("Unknown onboarding section");
  return steps[index + 1] ?? current; // Only canonical final completion writes done.
}
export function requiredOnboardingFields(
  persona: OnboardingPersona,
  payload: Record<string, any>,
): string[] {
  const required =
    persona === "field_employee"
      ? [
          "info.firstName",
          "info.lastName",
          "info.phone",
          "info.vendorRole",
          "photoUrl",
          "pec.certified",
          "pec.expirationDate",
        ]
      : [
          ...(persona === "partner"
            ? ONBOARDING_FIELDS["first-site"].concat(
                ONBOARDING_FIELDS["tax-billing"],
              )
            : ONBOARDING_FIELDS["tax-ids"].concat([
                "serviceArea.operatingRadiusMiles",
                "workTypeIds",
                "firstEmployee.firstName",
                "firstEmployee.lastName",
                "firstEmployee.email",
              ])),
        ];
  const missing = required.filter((path) => {
    const value = onboardingValue(payload, path);
    return (
      value == null ||
      value === "" ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.length)
    );
  });
  if (persona === "field_employee") {
    if (
      !["field", "foreman", "office", "both"].includes(
        payload.info?.vendorRole,
      ) &&
      !missing.includes("info.vendorRole")
    )
      missing.push("info.vendorRole");
    if (payload.pec?.certified !== true && !missing.includes("pec.certified"))
      missing.push("pec.certified");
  } else {
    if (
      payload.platformEula?.accepted !== true ||
      payload.platformEula?.version !== PLATFORM_EULA_VERSION
    )
      missing.push("platformEula");
    if (
      payload.legalConsent?.accepted !== true ||
      payload.legalConsent?.version !== LEGAL_POLICY_VERSION
    )
      missing.push("legalConsent");
    const radius = onboardingValue(
      payload,
      persona === "partner"
        ? "firstSite.siteRadiusMeters"
        : "serviceArea.operatingRadiusMiles",
    );
    if (!Number.isFinite(Number(radius)) || Number(radius) <= 0)
      missing.push(
        persona === "partner"
          ? "firstSite.siteRadiusMeters"
          : "serviceArea.operatingRadiusMiles",
      );
  }
  return [...new Set(missing)];
}
export function missingOnboardingSectionFields(
  persona: OnboardingPersona,
  section: string,
  payload: Record<string, any>,
): string[] {
  const prefix: Record<string, string> = {
    "platform-eula": "platformEula",
    "legal-consent": "legalConsent",
    "first-site": "firstSite",
    "tax-billing": "taxBilling",
    "tax-ids": "taxIds",
    "first-employee": "firstEmployee",
    "work-types": "serviceArea",
    "personal-info": "info",
    "photo-certs": "pec",
  };
  const fields = requiredOnboardingFields(persona, payload);
  return fields.filter(
    (field) =>
      field === prefix[section] ||
      field.startsWith(`${prefix[section]}.`) ||
      (section === "work-types" && field === "workTypeIds") ||
      (section === "photo-certs" && field === "photoUrl"),
  );
}
