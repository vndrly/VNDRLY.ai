// Per-persona, per-step onboarding scripts. Each entry is a focused
// micro-prompt the assistant injects when the user is on that step,
// listing the exact payload paths the wizard requires, the validation
// rules `validatePartnerPayload` / `validateVendorPayload` enforce in
// routes/onboarding.ts, and a short suggested phrasing for the model
// to ask the user. Keeping the data here (not buried in one big
// system prompt) makes it easy to audit drift against the wizard
// schema and gives the model surgical guidance instead of a
// kitchen-sink instruction blob.
//
// Required vs optional:
//   - "required" steps are validated by /onboarding/.../complete and
//     map 1:1 with REQUIRED_STEPS in routes/assistant.ts.
//   - "optional" steps can be skipped via complete_onboarding_step
//     ({skipped:true}).

export type OrgPersona = "partner" | "vendor" | "field_employee";

export interface FieldSpec {
  /** Dot-notated path inside onboardingProgress.payload (or top-level for booleans/arrays). */
  path: string;
  /** Plain-language label used when asking the user. */
  label: string;
  /** Short hint about what's accepted (e.g. "ISO date", "hex color"). */
  hint?: string;
  /** True when /complete will reject the org without this. */
  required: boolean;
}

export interface StepSpec {
  step: string;
  title: string;
  required: boolean;
  /** What this step accomplishes in one sentence. */
  purpose: string;
  /** Ordered fields to ask about; the model should ask one at a time. */
  fields: FieldSpec[];
  /** Step-specific guidance the model should weave into its turn. */
  guidance: string;
}

const partnerFlow: StepSpec[] = [
  {
    step: "company-basics",
    title: "Company basics",
    required: true,
    purpose: "Confirm the legal company name and DBA already captured at signup.",
    fields: [],
    guidance:
      "The legal name is already set from signup. Confirm it back to the user; if they need to change it, point them to the company-basics step in the wizard. Then mark this step complete and move on.",
  },
  {
    step: "branding",
    title: "Branding",
    required: true,
    purpose: "Capture brand colors and logos used across the partner UI, ticket headers, and visitor portal.",
    fields: [
      { path: "brandPrimaryColor", label: "Primary brand color", hint: "Hex (e.g. #1F6FEB)", required: true },
      { path: "brandAccentColor", label: "Accent brand color", hint: "Hex", required: true },
      { path: "logoUrl", label: "Horizontal logo URL", hint: "Used in sidebar and ticket headers", required: true },
      { path: "logoSquareUrl", label: "Square logo URL", hint: "Used for 64x64 favicon and visitor portal poster", required: true },
    ],
    guidance:
      "Both the horizontal and square logos are required — the visitor portal poster will look wrong without the square one. If the user only has one, ask whether they'd like help cropping a square version.",
  },
  {
    step: "first-site",
    title: "First site location",
    required: true,
    purpose: "Define at least one site so tickets and crew clock-ins have a place to land.",
    fields: [
      { path: "firstSite.name", label: "Site name", required: true },
      { path: "firstSite.address", label: "Site street address", required: true },
      { path: "firstSite.siteCode", label: "Short site code (used in URLs)", hint: "Lowercase, no spaces", required: true },
      { path: "firstSite.siteRadiusMeters", label: "Geofence radius (meters)", hint: "Default 1609 (~1 mile)", required: true },
    ],
    guidance:
      "The geofence radius is used by mobile clock-in proximity checks. 1609 meters (~1 mile) is the platform default; only change it if the user has a specific reason.",
  },
  {
    step: "tax-billing",
    title: "Tax IDs and billing",
    required: true,
    purpose: "Capture tax IDs and physical/billing addresses needed for invoicing.",
    fields: [
      { path: "taxBilling.federalTaxId", label: "Federal tax ID (EIN)", required: true },
      { path: "taxBilling.stateTaxId", label: "State tax ID", required: true },
      { path: "taxBilling.physicalAddress", label: "Physical address", required: true },
      { path: "taxBilling.billingAddress", label: "Billing address", hint: "May be the same as physical", required: true },
    ],
    guidance:
      "Both physical and billing addresses are mandatory per spec. Ask whether they're the same — if so, prefill billing with physical to save typing.",
  },
  {
    step: "preferences",
    title: "Notification preferences",
    required: false,
    purpose: "Pick default notification channels (email/SMS/Slack) for new tickets, invoice events, etc.",
    fields: [
      { path: "preferences.notifyOnNewTicket", label: "Notify on new ticket", required: false },
      { path: "preferences.notifyOnInvoiceReady", label: "Notify on invoice ready", required: false },
    ],
    guidance:
      "Optional. Defaults are sensible — offer to skip if the user wants to come back to this later.",
  },
  {
    step: "invite-team",
    title: "Invite teammates",
    required: false,
    purpose: "Send invite emails to additional admin or member teammates.",
    fields: [{ path: "inviteEmails", label: "Email addresses (comma-separated)", required: false }],
    guidance: "Optional. The user can always invite teammates later from Settings → Team.",
  },
];

const vendorFlow: StepSpec[] = [
  {
    step: "company-basics",
    title: "Company basics",
    required: true,
    purpose: "Confirm the legal vendor name from signup.",
    fields: [],
    guidance:
      "Already captured at signup. Confirm and move on.",
  },
  {
    step: "tax-ids",
    title: "Tax IDs and addresses",
    required: true,
    purpose: "Capture vendor tax IDs and billing addresses needed for 1099s.",
    fields: [
      { path: "taxIds.federalTaxId", label: "Federal tax ID (EIN)", required: true },
      { path: "taxIds.stateTaxId", label: "State tax ID", required: true },
      { path: "taxIds.physicalAddress", label: "Physical address", required: true },
      { path: "taxIds.billingAddress", label: "Billing address", required: true },
    ],
    guidance: "All four are mandatory. Mirror physical → billing if the user confirms they're the same.",
  },
  {
    step: "work-types",
    title: "Service area and work types",
    required: true,
    purpose: "Define how far you'll travel and what work you do.",
    fields: [
      { path: "serviceArea.operatingRadiusMiles", label: "Operating radius (miles)", required: true },
      { path: "workTypeIds", label: "Work types you offer", hint: "Pick from the catalog list", required: true },
    ],
    guidance:
      "Operating radius must be a positive number. At least one work type ID is required — if the user is unsure which categories apply, list a few common ones for their region (frac, drilling, completions, etc.).",
  },
  {
    step: "compliance",
    title: "Insurance and compliance",
    required: true,
    purpose: "Capture insurance policy details and upload the certificate.",
    fields: [
      { path: "compliance.carrier", label: "Insurance carrier name", required: true },
      { path: "compliance.policyNumber", label: "Policy number", required: true },
      { path: "compliance.expirationDate", label: "Policy expiration date", hint: "ISO date YYYY-MM-DD", required: true },
      { path: "compliance.documentUrl", label: "Insurance certificate (uploaded URL)", required: true },
    ],
    guidance:
      "The document URL must come from the wizard's upload flow — guide the user to drag-and-drop the COI PDF into the compliance step. If they paste a non-uploaded URL it'll fail.",
  },
  {
    step: "rates",
    title: "Rates and OT thresholds",
    required: true,
    purpose: "Set hourly billing rate, overtime thresholds, and 1099 e-delivery consent.",
    fields: [
      { path: "rates.hourlyRate", label: "Hourly rate (USD)", required: true },
      { path: "rates.dailyOtHours", label: "Daily OT threshold (hours)", hint: "Common: 8", required: true },
      { path: "rates.weeklyOtHours", label: "Weekly OT threshold (hours)", hint: "Common: 40", required: true },
      { path: "rates.overtimeMultiplier", label: "OT multiplier", hint: "Common: 1.50", required: true },
      { path: "eDeliveryConsent", label: "1099 e-delivery consent", hint: "Explicit true/false answer required", required: true },
    ],
    guidance:
      "eDeliveryConsent must be an explicit boolean — don't infer 'yes' from silence. Ask plainly: 'Do you consent to receive 1099s electronically instead of paper?'",
  },
  {
    step: "branding",
    title: "Vendor branding",
    required: false,
    purpose: "Optional logo and color for invoices/portal.",
    fields: [
      // Vendor branding is nested under `branding.*` (see VendorPayload
      // in onboarding-vendor.tsx). Partner branding lives at the top
      // level of the payload, but vendor branding does NOT — keep
      // these paths nested or set_onboarding_field will be rejected
      // by the wizard's PAYLOAD_TOP_KEYS guard.
      { path: "branding.brandPrimaryColor", label: "Primary brand color (optional)", required: false },
      { path: "branding.logoUrl", label: "Logo URL (optional)", required: false },
    ],
    guidance: "Skippable. Vendors without branding fall back to neutral defaults.",
  },
  {
    step: "first-employee",
    title: "First field employee",
    required: true,
    purpose: "Add the first crew member so you can issue invites and dispatch tickets.",
    fields: [
      { path: "firstEmployee.firstName", label: "First name", required: true },
      { path: "firstEmployee.lastName", label: "Last name", required: true },
      { path: "firstEmployee.email", label: "Email (used for invite)", required: true },
    ],
    guidance:
      "After completion, the wizard sends an invite email to that address. Make sure the user enters a real, monitored inbox — typos will silently fail.",
  },
];

const fieldEmployeeFlow: StepSpec[] = [
  {
    step: "personal-info",
    title: "Your info",
    required: true,
    purpose: "Confirm name and contact info already pre-filled by the inviting vendor.",
    fields: [
      { path: "info.firstName", label: "First name", required: true },
      { path: "info.lastName", label: "Last name", required: true },
      { path: "info.phone", label: "Mobile phone", required: true },
    ],
    guidance:
      "The vendor pre-filled these from the invite — confirm they're correct or correct them. Phone must be a US mobile number.",
  },
  {
    step: "photo-certs",
    title: "Photo and certifications",
    required: true,
    purpose: "Upload a profile photo and any safety certifications (H2S, PEC, OSHA, etc.).",
    fields: [
      { path: "photoUrl", label: "Profile photo (uploaded URL)", required: true },
      { path: "pec.documentUrl", label: "PEC/SafeLand certificate (if applicable)", required: false },
    ],
    guidance:
      "Profile photo is required (used for site check-in identity). Certs are upload-only — the user must use the wizard's drop zone, not paste a URL.",
  },
  {
    step: "set-password",
    title: "Set your password",
    required: true,
    purpose: "Choose a password so you can log into the field-app from now on.",
    fields: [{ path: "passwordSet", label: "Confirm password is set (handled by wizard)", required: true }],
    guidance:
      "The password itself is captured by the wizard's secure form — the assistant should NOT ask for or echo passwords. Just guide the user to the password input and confirm when they tell you it's set.",
  },
];

const FLOWS: Record<OrgPersona, StepSpec[]> = {
  partner: partnerFlow,
  vendor: vendorFlow,
  field_employee: fieldEmployeeFlow,
};

export function getStepSpec(persona: OrgPersona, step: string | null): StepSpec | null {
  if (!step) return null;
  return FLOWS[persona]?.find((s) => s.step === step) ?? null;
}

export function getFlow(persona: OrgPersona): readonly StepSpec[] {
  return FLOWS[persona];
}

/**
 * Render the step-specific guidance block injected into the system
 * prompt when the user is on a known step. Keeps payload paths,
 * validation rules, and suggested phrasings co-located so the model
 * has a single source of truth per step.
 */
export function renderStepGuidance(persona: OrgPersona, step: string | null): string {
  const spec = getStepSpec(persona, step);
  if (!spec) return "";
  const fieldsBlock =
    spec.fields.length === 0
      ? "(no payload fields — confirm and advance)"
      : spec.fields
          .map((f) => {
            const tag = f.required ? "REQUIRED" : "optional";
            const hint = f.hint ? ` — ${f.hint}` : "";
            return `- \`${f.path}\` (${tag}): ${f.label}${hint}`;
          })
          .join("\n");
  return `\n\nCURRENT STEP DETAIL — "${spec.title}" (${spec.step})
Purpose: ${spec.purpose}
Status: ${spec.required ? "Required (cannot be skipped)" : "Optional (skippable)"}

Fields to collect:
${fieldsBlock}

Guidance: ${spec.guidance}

Workflow:
1. Ask for one field at a time, in the order listed above.
2. After each answer, call set_onboarding_field with the exact \`path\` shown.
3. Once all required fields for this step are set, call complete_onboarding_step
   with skipped:false to advance.
4. If the step is optional and the user wants to defer, call complete_onboarding_step
   with skipped:true.`;
}
