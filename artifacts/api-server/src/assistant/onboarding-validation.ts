// Pure, side-effect-free onboarding validators shared between the
// assistant route handler (artifacts/api-server/src/routes/assistant.ts)
// and the regression test catalog
// (artifacts/vndrly/tests/assistant.spec.ts).
//
// The route used to inline this logic. Extracting it lets the tests
// drive the *real* validation function — not a mirror copy that can
// drift — and makes each error path a deterministic, executable check
// rather than a static catalog row.
//
// All exports here are pure: no DB, no I/O, no env reads.

import { PLATFORM_EULA_VERSION } from "@workspace/platform-eula";

export type Persona = "partner" | "vendor" | "field_employee";

export const REQUIRED_STEPS: Record<Persona, readonly string[]> = {
  partner: ["company-basics", "platform-eula", "first-site", "tax-billing"],
  vendor: ["company-basics", "platform-eula", "tax-ids", "work-types", "compliance", "rates", "first-employee"],
  field_employee: ["personal-info", "photo-certs", "set-password"],
};

// Full canonical sequence the wizard renders. Mirrors STEP_KEYS in
// the route. "done" is always the terminal pseudo-step.
export const STEP_KEYS: Record<Persona, readonly string[]> = {
  partner: ["company-basics", "platform-eula", "branding", "first-site", "tax-billing", "preferences", "invite-team", "done"],
  vendor: ["company-basics", "platform-eula", "branding", "tax-ids", "work-types", "compliance", "rates", "first-employee", "done"],
  field_employee: ["personal-info", "photo-certs", "set-password", "done"],
};

// Minimum payload paths a required step must have populated before
// the assistant is allowed to mark it complete (skipped:false). Each
// path is dot-notated relative to onboardingProgressTable.payload so
// `firstSite.name` looks up `payload.firstSite.name`.
export const STEP_REQUIRED_FIELDS: Record<Persona, Record<string, readonly string[]>> = {
  partner: {
    "platform-eula": ["platformEula.accepted", "platformEula.version"],
    "first-site": ["firstSite.name", "firstSite.address", "firstSite.siteCode", "firstSite.siteRadiusMeters"],
    "tax-billing": [
      "taxBilling.federalTaxId",
      "taxBilling.stateTaxId",
      "taxBilling.physicalAddress",
      "taxBilling.billingAddress",
    ],
    "company-basics": [],
  },
  vendor: {
    "platform-eula": ["platformEula.accepted", "platformEula.version"],
    "tax-ids": [
      "taxIds.federalTaxId",
      "taxIds.stateTaxId",
      "taxIds.physicalAddress",
      "taxIds.billingAddress",
    ],
    "work-types": ["serviceArea.operatingRadiusMiles", "workTypeIds"],
    "compliance": [
      "compliance.carrier",
      "compliance.policyNumber",
      "compliance.expirationDate",
      "compliance.documentUrl",
    ],
    "rates": [
      "rates.hourlyRate",
      "rates.dailyOtHours",
      "rates.weeklyOtHours",
      "rates.overtimeMultiplier",
      "eDeliveryConsent",
    ],
    "first-employee": ["firstEmployee.firstName", "firstEmployee.lastName", "firstEmployee.email"],
    "company-basics": [],
  },
  field_employee: {
    "personal-info": [],
    "photo-certs": [],
    "set-password": [],
  },
};

// The set of valid TOP-LEVEL payload keys per persona. Used to gate
// `set_onboarding_field` so the model can't write nonsense keys onto
// the row. Mirrors PAYLOAD_TOP_KEYS in the route handler.
export const PAYLOAD_TOP_KEYS: Record<Persona, readonly string[]> = {
  partner: [
    "brandPrimaryColor",
    "brandAccentColor",
    "logoUrl",
    "logoSquareUrl",
    "platformEula",
    "firstSite",
    "taxBilling",
    "preferences",
    "inviteEmails",
  ],
  vendor: [
    "platformEula",
    "taxIds",
    "serviceArea",
    "workTypeIds",
    "compliance",
    "rates",
    "overtimeMultiplier",
    "eDeliveryConsent",
    "branding",
    "firstEmployee",
  ],
  field_employee: ["info", "photoUrl", "pec"],
};

export function getPayloadPath(
  payload: Record<string, unknown> | null | undefined,
  path: string,
): unknown {
  if (!payload) return undefined;
  const parts = path.split(".");
  let cur: unknown = payload;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function isPayloadFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true; // explicit false is "filled" (e.g. eDeliveryConsent)
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

// ─── Validators ─────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ValidationErrorCode; error: string };

export type ValidationErrorCode =
  | "missing_args"
  | "invalid_step_name"
  | "required_step_skipped"
  | "out_of_sequence_step"
  | "out_of_sequence_next"
  | "missing_required_fields"
  | "invalid_payload_key";

/**
 * Validate a `complete_onboarding_step` tool call BEFORE any DB
 * writes. Mirrors the gating logic the assistant route runs.
 *
 * The split between this and the route is intentional: the route
 * handles auth + DB writes, this handles the deterministic rules.
 * The test harness exercises this function directly with synthetic
 * `existing` state so each error path is reproducible without a DB.
 */
export function validateStepCompletion(args: {
  persona: Persona;
  step: string | undefined;
  nextStep: string | undefined;
  skipped?: boolean;
  existing: { currentStep: string; payload: Record<string, unknown> | null };
}): ValidationResult {
  const { persona, step, nextStep, skipped, existing } = args;
  if (!step || !nextStep) {
    return { ok: false, code: "missing_args", error: "Missing 'step' or 'nextStep'." };
  }
  const validSteps = STEP_KEYS[persona];
  if (!validSteps.includes(step) || !validSteps.includes(nextStep)) {
    return {
      ok: false,
      code: "invalid_step_name",
      error: `Invalid step name. Valid steps for ${persona}: ${validSteps.join(", ")}.`,
    };
  }
  if (skipped && REQUIRED_STEPS[persona].includes(step)) {
    return {
      ok: false,
      code: "required_step_skipped",
      error: `Step '${step}' is required for ${persona} onboarding and cannot be skipped. Help the user fill in the required fields, then call complete_onboarding_step with skipped:false.`,
    };
  }
  if (existing.currentStep !== "done" && step !== existing.currentStep) {
    return {
      ok: false,
      code: "out_of_sequence_step",
      error: `You can only complete the user's current step '${existing.currentStep}', not '${step}'. Walk the user through one step at a time.`,
    };
  }
  const stepIdx = validSteps.indexOf(step);
  const nextIdx = validSteps.indexOf(nextStep);
  if (nextIdx !== stepIdx && nextIdx !== stepIdx + 1) {
    return {
      ok: false,
      code: "out_of_sequence_next",
      error: `Invalid transition '${step}' -> '${nextStep}'. nextStep must be the immediate next step in the wizard or the same step. Valid sequence: ${validSteps.join(" -> ")}.`,
    };
  }
  if (!skipped && REQUIRED_STEPS[persona].includes(step)) {
    const requiredPaths = STEP_REQUIRED_FIELDS[persona]?.[step] ?? [];
    const payload = (existing.payload ?? {}) as Record<string, unknown>;
    const missing = requiredPaths.filter((p) => !isPayloadFieldFilled(getPayloadPath(payload, p)));
    if (missing.length > 0) {
      return {
        ok: false,
        code: "missing_required_fields",
        error: `Cannot mark '${step}' complete — missing required fields: ${missing.join(", ")}. Use set_onboarding_field to fill them first.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Validate a `set_onboarding_field` tool call's `path`. Refuses
 * top-level keys outside the persona's allow list. Used to prevent
 * the model from writing nonsense keys (typo-driven hallucination).
 */
export function validateFieldPath(persona: Persona, path: string): ValidationResult {
  if (!path) {
    return { ok: false, code: "missing_args", error: "Missing 'path'." };
  }
  const top = path.split(".")[0];
  const allowed = PAYLOAD_TOP_KEYS[persona];
  if (!allowed.includes(top)) {
    return {
      ok: false,
      code: "invalid_payload_key",
      error: `Path '${path}' is not a valid onboarding field for ${persona}. Valid top-level keys: ${allowed.join(", ")}.`,
    };
  }
  return { ok: true };
}

/**
 * Build a fully-populated payload for a required step. Used by the
 * regression test's happy-path assertion to confirm that the
 * validator accepts the canonical "all required fields filled"
 * shape. Field values are shaped to satisfy isPayloadFieldFilled
 * (non-empty strings, finite numbers, true booleans).
 */
export function buildHappyPayload(persona: Persona, step: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of STEP_REQUIRED_FIELDS[persona]?.[step] ?? []) {
    setPath(out, p, sampleValue(p));
  }
  return out;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function sampleValue(path: string): unknown {
  const leaf = path.split(".").pop() ?? "";
  if (/^accepted$/i.test(leaf)) return true;
  if (/Hours|Multiplier|Radius|Miles/i.test(leaf)) return 1;
  if (/Consent/i.test(leaf)) return true;
  if (/^workTypeIds$/.test(leaf)) return ["1"];
  if (/^version$/i.test(leaf)) return PLATFORM_EULA_VERSION;
  return "value";
}
