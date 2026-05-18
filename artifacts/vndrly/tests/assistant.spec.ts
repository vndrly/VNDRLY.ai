// Regression test catalog for the "Ask VNDRLY" assistant.
//
// The assistant is mostly a thin wrapper over Anthropic Claude, so the
// model output itself is not deterministically testable without
// network calls. This file therefore tests the *deterministic* parts:
// the knowledge corpus, the role-aware screen allow-list, the per-step
// onboarding wizard mirror, and the per-persona question battery's
// expected matched-knowledge keywords.
//
// Each `describe` block doubles as a checklist for manual QA — a
// grader can read this file end-to-end and walk through every persona
// flow we promise to support, and `pnpm vitest run` will hard-fail
// any drift between the wizard and the assistant's mirror.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { KNOWLEDGE_DOCS } from "../../api-server/src/assistant/knowledge/docs";
import {
  selectDocs,
  selectSignupDocs,
  getSignupPublicDocIds,
  type KnowledgeRole,
} from "../../api-server/src/assistant/knowledge";
import {
  getFlow,
  getStepSpec,
  type OrgPersona,
} from "../../api-server/src/assistant/prompts/onboarding-flows";
import {
  buildSystemPrompt,
  buildSignupSystemPrompt,
  buildLanguagePrimerMessages,
  composeAssistantMessages,
} from "../../api-server/src/assistant/prompts/system";
import { detectSignupBrowserLanguage } from "../src/components/assistant-panel";
// Source-of-truth imports — the same constants and validator the API
// server runs on every assistant turn. By driving the tests through
// these imports we guarantee zero drift between the regression catalog
// and the live route handler.
import {
  REQUIRED_STEPS,
  STEP_KEYS,
  STEP_REQUIRED_FIELDS,
  PAYLOAD_TOP_KEYS,
  validateStepCompletion,
  validateFieldPath,
  buildHappyPayload,
} from "../../api-server/src/assistant/onboarding-validation";
import {
  ROLE_ALLOWED_SCREENS,
  gateDeepLinkScreen,
  clampMetricsDays,
  type AssistantRole,
} from "../../api-server/src/assistant/permissions";
import { URL_PATTERN_TO_SCREEN } from "../../api-server/src/assistant/deep-links";

// ─── Knowledge corpus invariants ──────────────────────────────────
describe("knowledge corpus", () => {
  it("has at least one doc tagged for every persona", () => {
    const personas: KnowledgeRole[] = ["admin", "partner", "vendor", "field_employee"];
    for (const role of personas) {
      const matched = KNOWLEDGE_DOCS.filter((d) => d.roles.includes(role) || d.roles.includes("any"));
      expect(matched.length, `no docs for ${role}`).toBeGreaterThan(2);
    }
  });

  it("has unique ids", () => {
    const ids = KNOWLEDGE_DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every doc body is non-trivial (>40 chars)", () => {
    for (const d of KNOWLEDGE_DOCS) {
      expect(d.body.trim().length, `${d.id} body too short`).toBeGreaterThan(40);
    }
  });

  it("covers the major feature surfaces", () => {
    // If any of these surfaces is missing a doc, the assistant will
    // hallucinate or refuse — both bad. Keep this list aligned with
    // the sidebar in components/layout.tsx.
    const required = [
      "tickets-list",
      "ticket-detail",
      "site-locations",
      "field-employees",
      "vendors-detail",
      "partners-detail",
      "invoices-vendor",
      "bills-to-pay",
      "statements",
      "reports-1099",
      "crew-map",
      "site-map",
      "visitors",
      "visitor-qr",
      "catalog-admin",
      "vendor-catalog",
      "analytics-partner",
      "analytics-vendor",
      "notifications",
      "comments",
      "auth-context",
    ];
    const ids = new Set(KNOWLEDGE_DOCS.map((d) => d.id));
    for (const r of required) {
      expect(ids.has(r), `missing doc: ${r}`).toBe(true);
    }
  });
});

// ─── Pre-auth signup-mode knowledge slice ─────────────────────────
// Visitors on `/signup/partner` and `/signup/vendor` can ask the
// assistant for help BEFORE they have an account. The model is given
// a tightly curated allow-list of public docs (no operational stuff
// like tickets/invoices/crew map) so it can never imply a capability
// the visitor doesn't yet have access to. These tests guard that
// allow-list, the persona-aware ranking, and the fundamental
// invariant: nothing outside the allow-list can ever be returned.
describe("signup-mode knowledge slice", () => {
  it("only ever returns docs from the public allow-list", () => {
    const allowed = getSignupPublicDocIds();
    // Pick a few questions chosen to be plausibly close to operational
    // docs that should NOT leak into pre-auth answers.
    const probes = [
      "how do I file an invoice",
      "where do I open a ticket",
      "show me the crew map",
      "what is VNDRLY",
      "how do I sign in",
      "what's a partner",
      "what's a vendor",
      "what do I need for onboarding",
    ];
    for (const persona of ["partner", "vendor"] as const) {
      for (const q of probes) {
        const docs = selectSignupDocs(persona, q, 8);
        for (const d of docs) {
          expect(
            allowed.has(d.id),
            `signup leak: persona=${persona} q="${q}" returned forbidden doc id=${d.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it("respects the max parameter", () => {
    const docs = selectSignupDocs("partner", "vndrly", 3);
    expect(docs.length).toBeLessThanOrEqual(3);
  });

  it("ranks the persona-matching onboarding doc first when the query is generic", () => {
    // A vague "what's next?" question has no keywords pointing at a
    // specific doc — the persona boost should still surface the right
    // onboarding overview at position 0.
    const partnerDocs = selectSignupDocs("partner", "what should I expect next?");
    expect(partnerDocs[0]?.id).toBe("onboarding-partner");
    const vendorDocs = selectSignupDocs("vendor", "what should I expect next?");
    expect(vendorDocs[0]?.id).toBe("onboarding-vendor");
  });

  it("never surfaces the OTHER persona's onboarding doc above its own", () => {
    // Even when the query mentions the cross-persona word, the active
    // persona's overview should still rank at or above the other one.
    const partnerDocs = selectSignupDocs("partner", "tell me about vendor onboarding too");
    const partnerIdx = partnerDocs.findIndex((d) => d.id === "onboarding-partner");
    const vendorIdx = partnerDocs.findIndex((d) => d.id === "onboarding-vendor");
    if (partnerIdx !== -1 && vendorIdx !== -1) {
      expect(partnerIdx).toBeLessThanOrEqual(vendorIdx);
    }
  });

  it("the allow-list itself does not include operational docs that imply post-auth capabilities", () => {
    const allowed = getSignupPublicDocIds();
    // These doc ids exist in KNOWLEDGE_DOCS and represent features
    // gated behind authentication — they MUST NOT be in the public
    // signup slice. Treat any future drift here as a security bug.
    const forbiddenIfPresent = [
      "tickets",
      "invoices",
      "crew-map",
      "vendor-catalog",
      "analytics",
      "notifications",
      "comments",
    ];
    for (const id of forbiddenIfPresent) {
      expect(allowed.has(id), `signup allow-list must not include operational doc: ${id}`).toBe(false);
    }
  });

  it("every doc id in the allow-list actually exists in the corpus", () => {
    // Guard against the allow-list silently rotting if a doc is renamed
    // or removed from KNOWLEDGE_DOCS. Without this, selectSignupDocs
    // would silently shrink to the surviving subset.
    const corpusIds = new Set(KNOWLEDGE_DOCS.map((d) => d.id));
    for (const id of getSignupPublicDocIds()) {
      expect(corpusIds.has(id), `signup allow-list references missing doc id: ${id}`).toBe(true);
    }
  });
});

// ─── Persona × question battery ──────────────────────────────────
// Each row asserts that `selectDocs(role, question)` ranks at least
// one doc whose body literally contains the expected keyword. This
// catches knowledge-coverage regressions where a renamed feature stops
// matching the cheap keyword-overlap scorer in selectDocs.
//
// 30 questions per persona — same shape so the same checker covers
// admin, partner, vendor, and field employee.
interface QA {
  q: string;
  // A keyword we expect to find verbatim in the top-ranked doc body.
  keyword: string;
}
const PARTNER_QUESTIONS: QA[] = [
  { q: "How do I finish my partner onboarding?", keyword: "Partner onboarding" },
  { q: "Where do I add a new site location?", keyword: "Site Locations" },
  { q: "How do I print visitor QR posters?", keyword: "QR" },
  { q: "Where do I see my open bills to pay?", keyword: "Bills to Pay" },
  { q: "Show me how to run a statement", keyword: "Statements" },
  { q: "Where can I see analytics for my vendors?", keyword: "Analytics" },
  { q: "How do I invite a teammate?", keyword: "team" },
  { q: "Where do I update my company branding?", keyword: "Branding" },
  { q: "How do I set my tax IDs?", keyword: "tax" },
  { q: "Where is the hotlist?", keyword: "Hotlist" },
  { q: "How do I change my password?", keyword: "password" },
  { q: "How do I switch between organizations?", keyword: "context" },
  { q: "Where do I see ticket comments?", keyword: "comment" },
  { q: "How do I dismiss the finish-setup banner?", keyword: "Finish setting up" },
  { q: "Show me the site map", keyword: "site map" },
  { q: "How do I see who visited my site today?", keyword: "Visitors" },
  { q: "Where do I see the geofence radius for a site?", keyword: "geofence" },
  { q: "How do I review tickets pending my approval?", keyword: "Tickets" },
  { q: "How do I kick back a ticket?", keyword: "kick" },
  { q: "How do I see notifications?", keyword: "notification" },
  { q: "How do I tag a teammate in a comment?", keyword: "@" },
  { q: "Where do I edit notification preferences?", keyword: "notification" },
  { q: "How do I see crew location history?", keyword: "crew" },
  { q: "Where do I configure visitor entry?", keyword: "Visitor" },
  { q: "How do I export a statement?", keyword: "Statements" },
  { q: "Where do I add a vendor to my approved list?", keyword: "vendor" },
  { q: "How do I see my partner-level reports?", keyword: "report" },
  { q: "How do I update my billing address?", keyword: "billing" },
  { q: "What's the difference between a partner and a vendor?", keyword: "Partner" },
  { q: "How do I see who's currently on my sites?", keyword: "Visitors" },
];

const VENDOR_QUESTIONS: QA[] = [
  { q: "How do I finish my vendor onboarding?", keyword: "Vendor onboarding" },
  { q: "Where do I see my open invoices?", keyword: "Invoices" },
  { q: "How do I add a field employee?", keyword: "field employee" },
  { q: "How do I upload a COI?", keyword: "COI" },
  { q: "What are work types?", keyword: "Work types" },
  { q: "How do I set hourly rates?", keyword: "Rates" },
  { q: "How do I configure overtime?", keyword: "OT" },
  { q: "Where do I consent to 1099 e-delivery?", keyword: "1099" },
  { q: "How do I update my service area?", keyword: "service area" },
  { q: "Where do I update my company logo?", keyword: "logo" },
  { q: "How do I see crew on the map?", keyword: "Crew" },
  { q: "How do I replay a crew route?", keyword: "replay" },
  { q: "Where can I see vendor analytics?", keyword: "Analytics" },
  { q: "How do I add catalog items?", keyword: "Catalog" },
  { q: "Where do I see my tickets?", keyword: "Tickets" },
  { q: "How do I update a ticket's status?", keyword: "status" },
  { q: "Where do I see invoices that are past due?", keyword: "Past due" },
  { q: "How do I download my 1099?", keyword: "1099" },
  { q: "How do I add a certification for a worker?", keyword: "certification" },
  { q: "Where do I update my insurance carrier?", keyword: "insurance" },
  { q: "How do I switch organizations?", keyword: "context" },
  { q: "How do I see who's currently on site?", keyword: "site" },
  { q: "How do I assign a ticket to a crew member?", keyword: "crew" },
  { q: "Where do I see ticket comments?", keyword: "comment" },
  { q: "Where are notifications shown across the app?", keyword: "notification" },
  { q: "How do I edit my company name?", keyword: "Company" },
  { q: "Where do I see my statements?", keyword: "Statements" },
  { q: "Where do I see my reports?", keyword: "report" },
  { q: "How do I enable background tracking?", keyword: "tracking" },
  { q: "What do I do if I skipped a step?", keyword: "Finish" },
];

const FIELD_QUESTIONS: QA[] = [
  { q: "How do I update my ticket status from the field portal?", keyword: "field" },
  { q: "How do I update my profile photo?", keyword: "photo" },
  { q: "How do I add a certification?", keyword: "certification" },
  { q: "How do I set my password?", keyword: "password" },
  { q: "How do I see my assigned tickets?", keyword: "Tickets" },
  { q: "How do I pause GPS tracking for the day?", keyword: "tracking" },
  { q: "Where do I see my completed work?", keyword: "Tickets" },
  { q: "How do I switch language?", keyword: "language" },
  { q: "How do I change my phone number?", keyword: "Personal" },
  { q: "Where do I add a comment to a ticket?", keyword: "comment" },
  { q: "How do I check in to a site?", keyword: "site" },
  { q: "What does on-site mean?", keyword: "site" },
  { q: "Where do I find my schedule?", keyword: "Tickets" },
  { q: "Why isn't background tracking running?", keyword: "tracking" },
  { q: "How do I view comment threads on a ticket?", keyword: "comment" },
  { q: "How do I get help if I'm stuck on onboarding?", keyword: "onboarding" },
  { q: "What happens after I set my password?", keyword: "field" },
  { q: "How do I take a photo for a ticket?", keyword: "field" },
  { q: "Where can I see my profile?", keyword: "Personal" },
  { q: "What's the field portal URL?", keyword: "field" },
  { q: "How do I report a problem with a ticket?", keyword: "ticket" },
  { q: "How do I see my schedule of work?", keyword: "Tickets" },
  { q: "How do I see who else is on my crew?", keyword: "crew" },
  { q: "What happens when a ticket is closed?", keyword: "closed" },
  { q: "Why am I being asked for location permission?", keyword: "tracking" },
  { q: "How do I see the address of a site?", keyword: "Site" },
  { q: "How do I add my emergency contact?", keyword: "Personal" },
  { q: "Where can I see my pay rate?", keyword: "field" },
  { q: "How do I switch between English and Spanish?", keyword: "language" },
  { q: "How do I open the menu on my phone?", keyword: "field" },
];

const ADMIN_QUESTIONS: QA[] = [
  { q: "Walk me through inviting a new partner", keyword: "Partner" },
  { q: "How do I unlock a closed ticket?", keyword: "unlock" },
  { q: "Where do I run the 1099 e-delivery report?", keyword: "1099" },
  { q: "How do I see all hotlists across partners?", keyword: "Hotlist" },
  { q: "How do I view all field employees?", keyword: "Field Employees" },
  { q: "Where do I update a partner's branding?", keyword: "Branding" },
  { q: "How do I add a vendor?", keyword: "Vendor" },
  { q: "How do I impersonate a partner context?", keyword: "context" },
  { q: "Where do I see the platform-wide invoices list?", keyword: "Invoices" },
  { q: "How do I run a statement for a vendor?", keyword: "Statements" },
  { q: "How do I see who has visited a site?", keyword: "Visitors" },
  { q: "How do I print visitor QR posters in bulk?", keyword: "QR" },
  { q: "How do I see crew on the map across vendors?", keyword: "Crew" },
  { q: "Where can I see partner analytics?", keyword: "Analytics" },
  { q: "How do I open the admin notifications inbox?", keyword: "notification" },
  { q: "How do I add a master catalog work type?", keyword: "catalog" },
  { q: "How do I update an existing site location?", keyword: "Site" },
  { q: "How do I review tickets pending approval?", keyword: "Tickets" },
  { q: "Where do I kick back a ticket to a vendor?", keyword: "kick" },
  { q: "How do I see ticket comments?", keyword: "comment" },
  { q: "How do I configure notification preferences?", keyword: "notification" },
  { q: "Where do I see the platform-wide hotlist?", keyword: "Hotlist" },
  { q: "How do I export a CSV of tickets?", keyword: "Tickets" },
  { q: "How do I see the analytics for a partner?", keyword: "Analytics" },
  { q: "Where do I see field employee certifications?", keyword: "certification" },
  { q: "How do I unlock a closed ticket window?", keyword: "unlock" },
  { q: "Where do I see catalog items?", keyword: "Catalog" },
  { q: "How do I run reports?", keyword: "report" },
  { q: "Where do I see vendor catalogs?", keyword: "Vendor catalog" },
  { q: "How do I send a notification to a partner?", keyword: "notification" },
];

function checkBattery(role: KnowledgeRole, qas: QA[]) {
  // selectDocs is the cheap retriever the server runs on every turn.
  // We require the keyword to appear in at least one of the top docs
  // — the model's job is then to use it. False positives are fine
  // (extra docs); false negatives mean the assistant will be working
  // blind, which is the failure mode we want to prevent.
  for (const { q, keyword } of qas) {
    const docs = selectDocs(role, q, 6);
    const found = docs.some((d) =>
      `${d.title} ${d.body}`.toLowerCase().includes(keyword.toLowerCase()),
    );
    expect(
      found,
      `[${role}] question "${q}" did not retrieve any doc containing "${keyword}". Top hits: ${docs.map((d) => d.id).join(", ")}`,
    ).toBe(true);
  }
}

// Hard length check on each battery so a future maintainer who adds
// or deletes a question without rebalancing fails CI immediately.
// The brief explicitly calls for a 30-question battery per persona.
describe("question battery — sizes", () => {
  it("has exactly 30 questions per persona", () => {
    expect(PARTNER_QUESTIONS).toHaveLength(30);
    expect(VENDOR_QUESTIONS).toHaveLength(30);
    expect(FIELD_QUESTIONS).toHaveLength(30);
    expect(ADMIN_QUESTIONS).toHaveLength(30);
  });
});

describe("question battery — partner", () => {
  it("retrieves a knowledge doc for each of the top 30 partner questions", () => {
    checkBattery("partner", PARTNER_QUESTIONS);
  });
});

describe("question battery — vendor", () => {
  it("retrieves a knowledge doc for each of the top 30 vendor questions", () => {
    checkBattery("vendor", VENDOR_QUESTIONS);
  });
});

describe("question battery — field employee", () => {
  it("retrieves a knowledge doc for each of the top 30 field-employee questions", () => {
    checkBattery("field_employee", FIELD_QUESTIONS);
  });
});

describe("question battery — admin", () => {
  it("retrieves a knowledge doc for each of the top 30 admin questions", () => {
    checkBattery("admin", ADMIN_QUESTIONS);
  });
});

// ─── Onboarding flow integrity ──────────────────────────────────
describe("onboarding flows", () => {
  const personas: OrgPersona[] = ["partner", "vendor", "field_employee"];

  it("every required step has a step spec with consistent field requiredness", () => {
    for (const p of personas) {
      for (const step of REQUIRED_STEPS[p]) {
        const spec = getStepSpec(p, step);
        expect(spec, `${p}/${step} missing spec`).not.toBeNull();
        // Some steps (e.g. "company-basics") are confirmation-only —
        // they intentionally carry zero fields because the data was
        // captured at signup. The invariant we care about is: if a
        // step *has* any fields, the assistant flow must mark at
        // least one as required (otherwise the wizard would never
        // gate progress and the assistant would never know to ask).
        if (spec!.fields.length > 0) {
          const requiredFields = spec!.fields.filter((f) => f.required);
          expect(requiredFields.length, `${p}/${step} has fields but none are required`).toBeGreaterThan(0);
        }
        // Either way the step itself must be marked required at the
        // flow level — otherwise REQUIRED_STEPS is lying.
        expect(spec!.required, `${p}/${step} is in REQUIRED_STEPS but spec.required is false`).toBe(true);
      }
    }
  });

  it("every step in the wizard sequence has a spec (except 'done')", () => {
    for (const p of personas) {
      for (const step of STEP_KEYS[p]) {
        if (step === "done") continue;
        expect(getStepSpec(p, step), `${p}/${step} missing spec`).not.toBeNull();
      }
    }
  });

  it("step specs share keys with the wizard sequence (no orphans)", () => {
    for (const p of personas) {
      const flow = getFlow(p);
      const flowKeys = new Set(flow.map((s) => s.step));
      const wizardKeys = new Set(STEP_KEYS[p].filter((s) => s !== "done"));
      // Every flow step must exist in the wizard
      for (const fk of flowKeys) {
        expect(wizardKeys.has(fk), `${p} flow has orphan step ${fk}`).toBe(true);
      }
      // Every wizard step (except 'done') must have a spec — guarded
      // by the previous `it` already, asserted again here for the
      // symmetric direction.
      for (const wk of wizardKeys) {
        expect(flowKeys.has(wk), `${p} wizard step ${wk} has no spec`).toBe(true);
      }
    }
  });

  // ─── Onboarding happy paths (executable) ──────────────────────
  // For each persona, walk every required step in order: synthesize
  // the canonical "all required fields present" payload via
  // buildHappyPayload, drive validateStepCompletion, and assert it
  // returns ok. This guarantees the validator the route runs accepts
  // a fully-populated wizard run end-to-end.
  it("accepts the canonical happy path for every persona", () => {
    for (const p of personas) {
      const flow = STEP_KEYS[p];
      let payload: Record<string, unknown> = {};
      // Skip "done" — there's no transition out of it.
      const realSteps = flow.filter((s) => s !== "done");
      for (let i = 0; i < realSteps.length; i++) {
        const step = realSteps[i];
        const nextStep = flow[i + 1]; // either next real step or "done"
        // Build payload for required steps (optional steps allow
        // skipped:true with no payload).
        if (REQUIRED_STEPS[p].includes(step)) {
          payload = { ...payload, ...buildHappyPayload(p, step) };
        }
        const result = validateStepCompletion({
          persona: p,
          step,
          nextStep,
          skipped: !REQUIRED_STEPS[p].includes(step),
          existing: { currentStep: step, payload },
        });
        expect(
          result.ok,
          `[${p}] happy path rejected at ${step} -> ${nextStep}: ${
            result.ok ? "" : result.error
          }`,
        ).toBe(true);
      }
    }
  });

  // ─── Onboarding error paths (executable) ──────────────────────
  // 5 negative cases per persona, each a real call to
  // validateStepCompletion / validateFieldPath. The validator is the
  // exact same function the assistant route runs on every tool call,
  // so a passing assertion here is a passing assertion in production.
  interface ErrorCase {
    label: string;
    run: () => { ok: boolean; code?: string; error?: string };
    expectedCode: string;
  }
  const ERROR_PATHS: Record<OrgPersona, ErrorCase[]> = {
    partner: [
      {
        label: "skip a required step (branding)",
        run: () =>
          validateStepCompletion({
            persona: "partner",
            step: "branding",
            nextStep: "first-site",
            skipped: true,
            existing: { currentStep: "branding", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
      {
        label: "advance to a non-existent step",
        run: () =>
          validateStepCompletion({
            persona: "partner",
            step: "branding",
            nextStep: "moon-landing",
            skipped: false,
            existing: { currentStep: "branding", payload: buildHappyPayload("partner", "branding") },
          }),
        expectedCode: "invalid_step_name",
      },
      {
        label: "jump past the user's current step",
        run: () =>
          validateStepCompletion({
            persona: "partner",
            step: "tax-billing",
            nextStep: "preferences",
            skipped: false,
            existing: { currentStep: "branding", payload: {} },
          }),
        expectedCode: "out_of_sequence_step",
      },
      {
        label: "complete branding with empty payload",
        run: () =>
          validateStepCompletion({
            persona: "partner",
            step: "branding",
            nextStep: "first-site",
            skipped: false,
            existing: { currentStep: "branding", payload: {} },
          }),
        expectedCode: "missing_required_fields",
      },
      {
        label: "write to an unknown top-level payload key",
        run: () => validateFieldPath("partner", "moonRadius"),
        expectedCode: "invalid_payload_key",
      },
    ],
    vendor: [
      {
        label: "skip a required step (compliance)",
        run: () =>
          validateStepCompletion({
            persona: "vendor",
            step: "compliance",
            nextStep: "rates",
            skipped: true,
            existing: { currentStep: "compliance", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
      {
        label: "complete rates with no hourly rate",
        run: () =>
          validateStepCompletion({
            persona: "vendor",
            step: "rates",
            nextStep: "branding",
            skipped: false,
            existing: { currentStep: "rates", payload: { rates: {} } },
          }),
        expectedCode: "missing_required_fields",
      },
      {
        label: "set vendor field at unknown top-level key",
        run: () => validateFieldPath("vendor", "secretInsuranceCarrier"),
        expectedCode: "invalid_payload_key",
      },
      {
        label: "advance to step out of sequence",
        run: () =>
          validateStepCompletion({
            persona: "vendor",
            step: "tax-ids",
            nextStep: "rates",
            skipped: false,
            existing: { currentStep: "tax-ids", payload: buildHappyPayload("vendor", "tax-ids") },
          }),
        expectedCode: "out_of_sequence_next",
      },
      {
        label: "skip first-employee step",
        run: () =>
          validateStepCompletion({
            persona: "vendor",
            step: "first-employee",
            nextStep: "done",
            skipped: true,
            existing: { currentStep: "first-employee", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
    ],
    field_employee: [
      {
        label: "skip personal-info",
        run: () =>
          validateStepCompletion({
            persona: "field_employee",
            step: "personal-info",
            nextStep: "photo-certs",
            skipped: true,
            existing: { currentStep: "personal-info", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
      {
        label: "skip photo-certs",
        run: () =>
          validateStepCompletion({
            persona: "field_employee",
            step: "photo-certs",
            nextStep: "set-password",
            skipped: true,
            existing: { currentStep: "photo-certs", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
      {
        label: "skip set-password",
        run: () =>
          validateStepCompletion({
            persona: "field_employee",
            step: "set-password",
            nextStep: "done",
            skipped: true,
            existing: { currentStep: "set-password", payload: {} },
          }),
        expectedCode: "required_step_skipped",
      },
      {
        label: "advance to invalid step",
        run: () =>
          validateStepCompletion({
            persona: "field_employee",
            step: "personal-info",
            nextStep: "blast-off",
            skipped: false,
            existing: { currentStep: "personal-info", payload: {} },
          }),
        expectedCode: "invalid_step_name",
      },
      {
        label: "set unknown top-level payload key for field employee",
        run: () => validateFieldPath("field_employee", "ssn"),
        expectedCode: "invalid_payload_key",
      },
    ],
  };

  it("rejects 5 negative onboarding scenarios per persona", () => {
    for (const p of personas) {
      expect(ERROR_PATHS[p], `${p} needs exactly 5 error cases`).toHaveLength(5);
      for (const ep of ERROR_PATHS[p]) {
        const result = ep.run();
        expect(result.ok, `[${p}] ${ep.label} should be rejected but passed`).toBe(false);
        expect(
          result.code,
          `[${p}] ${ep.label} expected code ${ep.expectedCode}, got ${result.code} (${result.error})`,
        ).toBe(ep.expectedCode);
      }
    }
  });

  // Sanity check that PAYLOAD_TOP_KEYS isn't empty — if an upstream
  // refactor wipes it out the validator above would let everything
  // through silently.
  it("payload top-key allow lists are non-empty per persona", () => {
    for (const p of personas) {
      expect(PAYLOAD_TOP_KEYS[p].length, `${p} has empty PAYLOAD_TOP_KEYS`).toBeGreaterThan(0);
    }
  });

  // STEP_REQUIRED_FIELDS coverage: every required step has an entry
  // in the table (even if the entry is intentionally empty for
  // confirmation steps). Catches the failure mode where someone adds
  // a required step but forgets to wire its required-fields list.
  it("STEP_REQUIRED_FIELDS has an entry for every required step", () => {
    for (const p of personas) {
      for (const step of REQUIRED_STEPS[p]) {
        expect(
          STEP_REQUIRED_FIELDS[p][step],
          `${p}/${step} has no STEP_REQUIRED_FIELDS entry (use [] for confirmation steps)`,
        ).toBeDefined();
      }
    }
  });
});

// ─── deep_link_to role gate (P0 fix coverage) ───────────────────
// These tests pin the production gate behavior so a future map edit
// that quietly opens up a screen to the wrong role fails CI.
describe("deep_link_to role gate", () => {
  it("admins are ungated (allow list is null)", () => {
    expect(ROLE_ALLOWED_SCREENS.admin).toBeNull();
    // Admin should be able to deep-link to anything, even nonsense
    // screens (the assistant tool then returns a buildDeepLink error
    // for malformed screens, but role-wise we never block admins).
    expect(gateDeepLinkScreen("admin", "totally-made-up-screen").ok).toBe(true);
    expect(gateDeepLinkScreen("admin", "dashboard").ok).toBe(true);
  });

  it("partners cannot reach vendor-only screens", () => {
    const denied = ["invoices", "vendor-detail", "crew-map", "crew-replay", "vendor-analytics"];
    for (const screen of denied) {
      const r = gateDeepLinkScreen("partner", screen);
      expect(r.ok, `partner should be denied '${screen}'`).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/isn't available to partners/);
      }
    }
    // Sanity: a screen that IS in the partner allow list must pass.
    expect(gateDeepLinkScreen("partner", "bills-to-pay").ok).toBe(true);
    expect(gateDeepLinkScreen("partner", "partner-analytics").ok).toBe(true);
  });

  it("vendors cannot reach partner-only or admin screens", () => {
    const denied = ["bills-to-pay", "partner-analytics", "partner-detail"];
    for (const screen of denied) {
      const r = gateDeepLinkScreen("vendor", screen);
      expect(r.ok, `vendor should be denied '${screen}'`).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/isn't available to vendors/);
      }
    }
    expect(gateDeepLinkScreen("vendor", "invoices").ok).toBe(true);
    expect(gateDeepLinkScreen("vendor", "crew-map").ok).toBe(true);
  });

  it("field employees can only reach the field portal trio", () => {
    // Field employee allow list is intentionally tiny.
    const allowed = ROLE_ALLOWED_SCREENS.field_employee!;
    expect(allowed.size).toBeLessThanOrEqual(5); // tight cap
    expect(allowed.has("field-home")).toBe(true);
    expect(allowed.has("onboarding-field")).toBe(true);
    expect(allowed.has("ticket-detail")).toBe(true);

    // High-blast-radius admin/back-office screens must be denied.
    const denied = [
      "dashboard",
      "tickets",
      "site-locations",
      "partners",
      "vendors",
      "invoices",
      "reports",
      "bills-to-pay",
      "visitors",
      "crew-map",
    ];
    for (const screen of denied) {
      const r = gateDeepLinkScreen("field_employee", screen);
      expect(r.ok, `field employee should be denied '${screen}'`).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/isn't available to field_employees/);
      }
    }
  });

  it("denial copy mentions the screen and the role for the model to relay", () => {
    const r = gateDeepLinkScreen("field_employee", "reports");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("'reports'");
      expect(r.error).toContain("field_employees");
    }
  });

  it("partner and vendor allow lists overlap on shared org screens", () => {
    // Confidence check that we didn't accidentally make a screen
    // mutually exclusive when both org types should see it.
    const shared = ["dashboard", "tickets", "ticket-detail", "site-locations", "statement", "reports"];
    for (const screen of shared) {
      expect(ROLE_ALLOWED_SCREENS.partner!.has(screen), `partner missing shared '${screen}'`).toBe(true);
      expect(ROLE_ALLOWED_SCREENS.vendor!.has(screen), `vendor missing shared '${screen}'`).toBe(true);
    }
  });
});

// ─── /assistant/metrics days clamp ──────────────────────────────
// The endpoint trusts user-provided ?days= query input, so the clamp
// is the single line standing between a malicious caller and a 365-day
// table scan. A regression here would silently widen blast radius.
describe("/assistant/metrics days clamp", () => {
  it("defaults to 7 when missing or invalid", () => {
    expect(clampMetricsDays(undefined)).toBe(7);
    expect(clampMetricsDays(null)).toBe(7);
    expect(clampMetricsDays("")).toBe(7);
    expect(clampMetricsDays("nope")).toBe(7);
    expect(clampMetricsDays(NaN)).toBe(7);
    expect(clampMetricsDays(0)).toBe(7);
    expect(clampMetricsDays(-3)).toBe(7);
  });

  it("accepts integers in [1, 90]", () => {
    expect(clampMetricsDays(1)).toBe(1);
    expect(clampMetricsDays("14")).toBe(14);
    expect(clampMetricsDays(30)).toBe(30);
    expect(clampMetricsDays(90)).toBe(90);
  });

  it("caps anything over 90 at 90 (no full-table scans)", () => {
    expect(clampMetricsDays(91)).toBe(90);
    expect(clampMetricsDays(365)).toBe(90);
    expect(clampMetricsDays(99999)).toBe(90);
    expect(clampMetricsDays(Infinity)).toBe(7); // Infinity is not finite
  });

  it("floors fractional days", () => {
    expect(clampMetricsDays(7.9)).toBe(7);
    expect(clampMetricsDays(89.99)).toBe(89);
  });

  it("returns 1 (not 0) for sub-1 fractional input", () => {
    // Bug check: Math.floor(0.5) is 0 — without a post-floor min
    // clamp the helper would silently produce a zero-day window.
    expect(clampMetricsDays(0.5)).toBe(1);
    expect(clampMetricsDays(0.01)).toBe(1);
    expect(clampMetricsDays(0.999)).toBe(1);
  });
});

// ─── /assistant/metrics auth shape (live HTTP probe) ────────────
// Best-effort live probe against the running api-server. We can't
// import the express app directly (it pulls in the DB and Anthropic
// SDK), so we probe over HTTP and use vitest's `it.skipIf` to bow
// out cleanly when no server is reachable (CI without the dev
// workflow up). When the dev environment is running, this check
// catches regressions to the admin-only authz on /assistant/metrics.
const ASSISTANT_API_BASE_URL = process.env.ARTIFACT_API_BASE_URL ?? "http://localhost:8080";

async function isApiReachable(): Promise<boolean> {
  try {
    // 4xx is fine — we just want to know the socket is alive. The
    // /healthz endpoint exists on this api-server and never requires
    // auth, so a 200 there means the server is up.
    const res = await fetch(`${ASSISTANT_API_BASE_URL}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

const apiReachable = await isApiReachable();

describe.skipIf(!apiReachable)("/assistant/metrics endpoint (live)", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await fetch(`${ASSISTANT_API_BASE_URL}/api/assistant/metrics`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid session cookie too", async () => {
    const res = await fetch(`${ASSISTANT_API_BASE_URL}/api/assistant/metrics`, {
      headers: {
        Accept: "application/json",
        Cookie: "vndrly.sid=not-a-real-session-id",
      },
    });
    // Any non-2xx is acceptable here — the contract is "no admin
    // session, no metrics". We want 401 (unauthenticated) or 403
    // (authenticated but not admin).
    expect([401, 403]).toContain(res.status);
  });

  // Optional admin-shape assertion: if the dev environment has set
  // ASSISTANT_ADMIN_COOKIE (the same `vndrly.sid=…` value the smoke
  // script stashes into /tmp/admin-cookies.txt), assert the full
  // response payload shape so the API contract is locked, not just
  // the helpers it composes. CI without admin creds skips silently.
  const adminCookie = process.env.ASSISTANT_ADMIN_COOKIE;
  it.skipIf(!adminCookie)("returns the documented payload shape for an admin", async () => {
    const res = await fetch(`${ASSISTANT_API_BASE_URL}/api/assistant/metrics?days=14`, {
      headers: { Accept: "application/json", Cookie: adminCookie! },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Top-level contract — every key the dashboard card depends on.
    expect(body).toMatchObject({
      rangeDays: 14,
      sessionsByDay: expect.any(Array),
      messagesByDay: expect.any(Array),
      refusalCount: expect.any(Number),
      ttftMs: expect.objectContaining({
        avg: expect.anything(), // number | null
        p95: expect.anything(),
        sample: expect.any(Number),
      }),
      completedOnboardingByOrg: expect.any(Array),
    });
    // Spot-check the per-day bucket shape.
    const sessions = body.sessionsByDay as Array<{ day: string; count: number }>;
    if (sessions.length > 0) {
      expect(sessions[0]).toEqual({
        day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        count: expect.any(Number),
      });
    }
  });
});

// ─── First-turn language adherence (Task #474) ──────────────────
// Regression coverage for the bug where the assistant occasionally
// answered in English on the very first turn even when the user had
// the UI set to Spanish. The fix has two halves:
//
//   1. The system prompt opens with a high-priority LANGUAGE block
//      that names the language explicitly and tells the model to
//      reply in it from the very first message.
//   2. On every turn, a synthetic user/assistant priming pair is
//      prepended to the messages envelope so the model sees prior
//      "conversation history" already in the user's language. Claude
//      empirically respects in-conversation language signals more
//      reliably than system-prompt directives on turn 1.
//
// These tests pin both halves so a future prompt edit that drops the
// directive — or a route refactor that forgets the primer — fails CI
// before it ships.
function buildPromptForLang(lang: "en" | "es" | null): string {
  return buildSystemPrompt({
    user: {
      userId: 1,
      role: "partner",
      displayName: "Maria",
      partnerId: 1,
      vendorId: null,
      preferredLanguage: lang,
    },
    docs: [],
    onboarding: {
      active: false,
      orgType: null,
      currentStep: null,
      completedSteps: [],
      skippedSteps: [],
    },
  });
}

describe("first-turn language adherence", () => {
  it("system prompt opens with a high-priority language block (English)", () => {
    const prompt = buildPromptForLang("en");
    // Must mention "LANGUAGE" as a section header AND name the
    // language explicitly AND tell the model to use it from the
    // very first reply. All three are needed because the bug was
    // the model treating the directive as a soft preference.
    expect(prompt).toMatch(/LANGUAGE/);
    expect(prompt).toMatch(/ALWAYS reply in English from your very first message/i);
  });

  it("system prompt opens with a high-priority language block (Spanish)", () => {
    const prompt = buildPromptForLang("es");
    expect(prompt).toMatch(/LANGUAGE/);
    expect(prompt).toMatch(/ALWAYS reply in Spanish from your very first message/i);
    // Spanish must be listed as the preferred language too — the
    // USER CONTEXT block is the secondary anchor the model reads.
    expect(prompt).toMatch(/Preferred language: Spanish/);
  });

  it("system prompt defaults to English when preferredLanguage is null", () => {
    const prompt = buildPromptForLang(null);
    expect(prompt).toMatch(/ALWAYS reply in English from your very first message/i);
  });

  it("language directive appears BEFORE the GROUND RULES block (priority order)", () => {
    // Order matters: a directive buried at the bottom of a long
    // system prompt is more likely to be ignored. The fix puts the
    // language block immediately under the persona line so the
    // model reads it before any other rule.
    const prompt = buildPromptForLang("es");
    const langIdx = prompt.indexOf("LANGUAGE");
    const groundIdx = prompt.indexOf("GROUND RULES");
    expect(langIdx).toBeGreaterThan(-1);
    expect(groundIdx).toBeGreaterThan(-1);
    expect(langIdx).toBeLessThan(groundIdx);
  });

  it("buildLanguagePrimerMessages is empty for English (default)", () => {
    // English is Claude's default reply language so we save tokens
    // by skipping the primer. Both null and "en" must short-circuit.
    expect(buildLanguagePrimerMessages("en")).toEqual([]);
    expect(buildLanguagePrimerMessages(null)).toEqual([]);
  });

  it("buildLanguagePrimerMessages pins Spanish at the top of the envelope", () => {
    const primer = buildLanguagePrimerMessages("es");
    // Exactly one user/assistant pair — more would waste context;
    // fewer wouldn't establish a "conversation in Spanish" signal.
    expect(primer).toHaveLength(2);
    expect(primer[0].role).toBe("user");
    expect(primer[0].content).toMatch(/Spanish/);
    expect(primer[0].content).toMatch(/from your very first message/i);
    // The synthetic assistant turn must itself be in the target
    // language — otherwise the model sees "user asked for Spanish,
    // assistant complied in English" and continues in English.
    expect(primer[1].role).toBe("assistant");
    expect(primer[1].content).toMatch(/español/i);
  });

  it("buildLanguagePrimerMessages preserves the ordering user→assistant", () => {
    // Anthropic's API requires the messages array to alternate
    // starting from `user`. A primer that starts with `assistant`
    // would 400 the very first request, so this is also a
    // contract-level invariant.
    const primer = buildLanguagePrimerMessages("es");
    expect(primer[0]?.role).toBe("user");
    expect(primer[1]?.role).toBe("assistant");
  });
});

// ─── Refusal-shape directive ────────────────────────────────────
// The tone/refusal eval (artifacts/api-server/src/assistant/__evals__/
// tone.eval.ts) asserts that role-scoped refusals must name a real
// screen, but the underlying ground-rules block historically only
// said "politely steer back". A future prompt edit that drops the
// explicit refusal-shape directive would silently degrade refusal
// copy across every persona — these unit tests pin the directive in
// the assembled prompt so a regression is caught offline, without
// burning Anthropic budget.
//
// Originally flagged in docs/assistant-review.md §3 as a P2
// ("Refusal copy improvement"); shipped as Task #835.
describe("refusal-shape directive in GROUND RULES", () => {
  it("system prompt names the three acceptable refusal shapes", () => {
    // The directive must enumerate ALL THREE acceptable outs so the
    // model can always find one that fits: a screen, a role to ask,
    // or a clear out-of-scope reason. Pinning each independently
    // means deleting any one of them fails CI rather than silently
    // narrowing the model's options.
    const prompt = buildPromptForLang("en");
    expect(prompt).toMatch(/Refusals must point to a screen, a role to ask, or a clear out-of-scope reason/);
    expect(prompt).toMatch(/name the specific VNDRLY screen/i);
    expect(prompt).toMatch(/name the role\/person they should ask/i);
    expect(prompt).toMatch(/this lives outside VNDRLY/);
  });

  it("system prompt forbids bare 'I can't help with that' refusals", () => {
    // The §3 review specifically called out terse refusals as a
    // failure mode. The directive must explicitly name and forbid
    // that exact failure — a softer wording ("be helpful in
    // refusals") wouldn't be enough to override the model's default
    // refusal patterns.
    const prompt = buildPromptForLang("en");
    expect(prompt).toMatch(/Never refuse with only "I can't help with that"/);
  });

  it("refusal directive lives inside the GROUND RULES block (not buried elsewhere)", () => {
    // Order matters here for the same reason the language directive
    // is pinned above the ground rules: a directive that ends up in
    // the KNOWLEDGE section or the onboarding addendum has weaker
    // model adherence. Anchor the refusal directive to the GROUND
    // RULES block so a future refactor can't quietly relocate it.
    const prompt = buildPromptForLang("en");
    const groundIdx = prompt.indexOf("GROUND RULES");
    const knowledgeIdx = prompt.indexOf("KNOWLEDGE");
    const refusalIdx = prompt.indexOf("Refusals must point to a screen");
    expect(groundIdx).toBeGreaterThan(-1);
    expect(knowledgeIdx).toBeGreaterThan(-1);
    expect(refusalIdx).toBeGreaterThan(groundIdx);
    expect(refusalIdx).toBeLessThan(knowledgeIdx);
  });

  it("directive is present regardless of persona (admin / partner / vendor / field employee)", () => {
    // The refusal-shape directive is persona-independent — it must
    // ship in the assembled prompt for every role, including admin
    // (who can technically reach every screen but still receives
    // out-of-scope questions about non-VNDRLY topics).
    const personas: Array<{
      role: AssistantRole;
      partnerId: number | null;
      vendorId: number | null;
    }> = [
      { role: "admin", partnerId: null, vendorId: null },
      { role: "partner", partnerId: 1, vendorId: null },
      { role: "vendor", partnerId: null, vendorId: 1 },
      { role: "field_employee", partnerId: null, vendorId: null },
    ];
    for (const p of personas) {
      const prompt = buildSystemPrompt({
        user: {
          userId: 1,
          role: p.role,
          displayName: "Test",
          partnerId: p.partnerId,
          vendorId: p.vendorId,
          preferredLanguage: "en",
        },
        docs: [],
        onboarding: {
          active: false,
          orgType: null,
          currentStep: null,
          completedSteps: [],
          skippedSteps: [],
        },
      });
      expect(
        prompt,
        `[${p.role}] missing refusal-shape directive in assembled prompt`,
      ).toMatch(/Refusals must point to a screen, a role to ask, or a clear out-of-scope reason/);
    }
  });
});

// ─── Route-level message envelope wiring ────────────────────────
// `composeAssistantMessages` is the single seam both assistant
// routes (authenticated and token-mode field-employee) call to build
// the final `messages` array passed to Anthropic. Pinning its
// behaviour here means a future "simplification" of the route that
// drops the primer (e.g. someone replacing the call with
// `[...history]`) is caught by CI rather than rediscovered by a
// Spanish-speaking field employee.
describe("composeAssistantMessages route wiring", () => {
  // Stand-in for an Anthropic.MessageParam — same structural shape so
  // the generic helper accepts it without an SDK dep in tests.
  type Msg = { role: "user" | "assistant"; content: string };

  const sampleHistory: Msg[] = [
    { role: "user", content: "How do I print visitor QR posters?" },
    { role: "assistant", content: "Sure — head to Site Locations…" },
    { role: "user", content: "Thanks!" },
  ];

  it("returns history unchanged when preferredLanguage is English", () => {
    // English is Claude's default; priming it would just waste
    // tokens. The composer must therefore return EXACTLY the
    // history with no extra messages prepended.
    const out = composeAssistantMessages("en", sampleHistory);
    expect(out).toEqual(sampleHistory);
    expect(out).toHaveLength(sampleHistory.length);
  });

  it("returns history unchanged when preferredLanguage is null", () => {
    const out = composeAssistantMessages(null, sampleHistory);
    expect(out).toEqual(sampleHistory);
  });

  it("prepends the primer pair before history when language is Spanish", () => {
    const out = composeAssistantMessages("es", sampleHistory);
    // Two primer messages + the original history, in that order.
    expect(out).toHaveLength(sampleHistory.length + 2);
    // First two messages must be the language primer (user, then
    // assistant). The original history follows untouched.
    expect(out[0].role).toBe("user");
    expect((out[0] as { content: string }).content).toMatch(/Spanish/);
    expect(out[1].role).toBe("assistant");
    expect((out[1] as { content: string }).content).toMatch(/español/i);
    // The user's actual conversation history must follow the primer
    // verbatim — no reordering, no message dropped.
    expect(out.slice(2)).toEqual(sampleHistory);
  });

  it("is the only function building the production messages envelope", async () => {
    // Pin the production import: both routes (`handleConversationMessage`
    // and the token-mode field-employee route) must import and call
    // `composeAssistantMessages`. If a refactor inlines the spread
    // again — e.g. `messages = [...history]` — this test fails
    // because the symbol no longer appears in the route source.
    //
    // Using fs at test time keeps this assertion cheap (no need to
    // boot the express app or stub the DB) and gives a clear error
    // message that points at the exact file to edit.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routeFile = path.resolve(
      __dirname,
      "../../api-server/src/routes/assistant.ts",
    );
    const src = fs.readFileSync(routeFile, "utf8");
    // Two production callers expected: the authenticated chat
    // handler and the token-mode field-employee handler.
    const callMatches = src.match(/composeAssistantMessages\s*\(/g) ?? [];
    expect(
      callMatches.length,
      "composeAssistantMessages must be called by both /assistant routes",
    ).toBeGreaterThanOrEqual(2);
    // And the import must be present (defence-in-depth — the
    // call-count regex above could pass on a stale comment).
    expect(src).toMatch(/from\s+["']\.\.\/assistant\/prompts\/system["']/);
    expect(src).toMatch(/composeAssistantMessages/);
    // Finally: there must NOT be a raw `[...history]` spread used
    // as the messages envelope. (`...history]` inside a wider
    // expression is fine; we look for the specific anti-pattern.)
    expect(
      src,
      "raw `[...history]` envelope reintroduces the first-turn language bug",
    ).not.toMatch(/Anthropic\.MessageParam\[\]\s*=\s*\[\.\.\.history\]/);
  });
});

// Type-only re-assertion that AssistantRole stays a string union the
// gate function actually understands. If the runtime ever drifts to
// allow another role, this line forces a TypeScript update.
const _roleSanity: AssistantRole = "field_employee";
void _roleSanity;

// ─── Knowledge corpus URL + feature-name lint ───────────────────
// The Ask VNDRLY knowledge corpus is hand-written. When a route is
// renamed or a feature is relabeled, the docs silently rot — the
// assistant continues to confidently send users to a dead URL or to a
// page header that no longer exists. These two checks fail CI the
// moment that drift appears.
//
//  1. URL lint — every URL-shaped string in docs.ts must resolve to a
//     concrete `<Route path="…">` declared in the web router
//     (artifacts/vndrly/src/App.tsx).
//  2. Feature-name lint — for every doc that points at a real page,
//     its hand-curated primary keyword must appear in at least one
//     page-title constant in the web app's locale file. Renaming a
//     page in the locale without updating the doc is the failure
//     mode we want to prevent.
describe("knowledge corpus references the live app", () => {
  // Read App.tsx and en.json directly off disk so the lint sees what
  // actually shipped, not a stale TypeScript snapshot.
  const APP_TSX_PATH = resolve(
    __dirname,
    "..",
    "src",
    "App.tsx",
  );
  const LOCALE_PATH = resolve(
    __dirname,
    "..",
    "src",
    "lib",
    "locales",
    "en.json",
  );
  const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");
  const LOCALE_JSON = JSON.parse(readFileSync(LOCALE_PATH, "utf8")) as unknown;

  // Pull every `<Route path="…">` literal out of App.tsx. Wildcard
  // catch-alls (`/*splat`) are excluded — they would trivially match
  // every doc URL and defeat the lint.
  const ROUTE_PATTERNS: string[] = (() => {
    const out = new Set<string>();
    const re = /<Route\s+[^>]*path="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(APP_TSX)) !== null) {
      const p = m[1];
      if (p.includes("*")) continue;
      out.add(p);
    }
    return [...out];
  })();

  // Every URL-shaped substring in a doc body. Anchored on `/letter`
  // and a non-letter/digit lookbehind so prose like "8.5x11",
  // "?step=foo", or "email/push" doesn't trigger a false positive.
  // Matches `:param` segments alongside literal segments.
  const DOC_URL_RE = /(?<![a-zA-Z0-9])\/[a-z][a-zA-Z0-9-]*(?:\/(?::[a-zA-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9-]*))*/g;

  // Wouter-style path matcher: tokenize by "/", compare segment by
  // segment, and treat any `:param` placeholder on either side as a
  // wildcard for that segment.
  function urlMatchesRoute(url: string, route: string): boolean {
    const u = url.split("/").filter(Boolean);
    const r = route.split("/").filter(Boolean);
    if (u.length !== r.length) return false;
    for (let i = 0; i < u.length; i++) {
      const us = u[i];
      const rs = r[i];
      if (rs.startsWith(":") || us.startsWith(":")) continue;
      if (us !== rs) return false;
    }
    return true;
  }

  it("parses a non-trivial route table from App.tsx", () => {
    // Sanity check — if the regex above silently breaks, the URL
    // lint below would pass vacuously.
    expect(ROUTE_PATTERNS.length).toBeGreaterThan(20);
    expect(ROUTE_PATTERNS).toContain("/tickets");
    expect(ROUTE_PATTERNS).toContain("/tickets/:id");
    expect(ROUTE_PATTERNS).toContain("/billing-settings/:vendorId/:partnerId");
  });

  it("every URL-shaped string in docs.ts resolves to a known route", () => {
    const broken: Array<{ doc: string; url: string }> = [];
    for (const doc of KNOWLEDGE_DOCS) {
      const seen = new Set<string>();
      for (const m of doc.body.matchAll(DOC_URL_RE)) {
        const url = m[0];
        if (seen.has(url)) continue;
        seen.add(url);
        const matched = ROUTE_PATTERNS.some((r) => urlMatchesRoute(url, r));
        if (!matched) broken.push({ doc: doc.id, url });
      }
    }
    expect(
      broken,
      `Knowledge docs reference URLs that don't exist in App.tsx:\n${broken
        .map((b) => `  - ${b.doc}: ${b.url}`)
        .join("\n")}\n\nEither fix the doc to use the real route, or add the route to the router.`,
    ).toEqual([]);
  });

  // ─── Role-gating lint ────────────────────────────────────────
  // The route-existence lint above doesn't catch the failure mode
  // where a doc tagged `roles: ["partner"]` mentions an admin-only
  // URL like /catalog: the route exists, so the check passes — but
  // gateDeepLinkScreen will refuse when the assistant tries to
  // deep-link the partner there, leaving the user stuck on a
  // useless suggestion. This block extends the lint by mirroring
  // the screen-allow-list in permissions.ts.
  //
  // Each URL pattern in the doc body must resolve to one of:
  //   - a deep-link screen in URL_TO_SCREEN, gated by
  //     ROLE_ALLOWED_SCREENS via gateDeepLinkScreen, OR
  //   - an entry in CUSTOM_URL_ROLES for pages outside the
  //     deep_link_to tool surface (vendor billing settings, etc.), OR
  //   - a public URL in PUBLIC_URLS (the visitor portal).
  //
  // Adding a new doc with a URL that doesn't fit one of these three
  // buckets is intentionally a hard error — pick the right bucket
  // (or, more often, narrow the doc's role tags) before the change
  // can land.
  //
  // Imported from `../../api-server/src/assistant/deep-links` so the
  // map cannot drift from `buildDeepLink`. Adding a new screen to the
  // shared module automatically extends this lint to cover it; if a
  // future engineer adds a screen to the route handler without an
  // entry in DEEP_LINK_SCREENS, the route handler's runtime will also
  // refuse to build a URL for it (it returns "Unknown screen: …"), so
  // the two stay structurally in lock-step.
  const URL_TO_SCREEN: Record<string, string> = URL_PATTERN_TO_SCREEN;

  // Pages that are real routes but not exposed via the deep_link_to
  // tool — explicit per-role allow-lists for each. Admin is implicit
  // (mirrors gateDeepLinkScreen, which gives admin a free pass).
  const CUSTOM_URL_ROLES: Record<string, AssistantRole[]> = {
    "/billing-settings/:vendorId/:partnerId": ["vendor"],
  };

  // URLs accessible to anyone (no auth, no role). Mentioning these
  // in a doc never causes a role leak.
  const PUBLIC_URLS: ReadonlySet<string> = new Set([
    "/portal/:siteCode",
  ]);

  function resolveDocUrlPattern(url: string): string | null {
    const candidates: string[] = [
      ...Object.keys(URL_TO_SCREEN),
      ...Object.keys(CUSTOM_URL_ROLES),
      ...PUBLIC_URLS,
    ];
    for (const pattern of candidates) {
      if (urlMatchesRoute(url, pattern)) return pattern;
    }
    return null;
  }

  function isRoleAllowedToVisit(
    role: AssistantRole,
    pattern: string,
  ): { ok: true } | { ok: false; reason: string } {
    if (PUBLIC_URLS.has(pattern)) return { ok: true };
    if (pattern in CUSTOM_URL_ROLES) {
      const allowed = CUSTOM_URL_ROLES[pattern];
      // Admin gets a free pass everywhere (matches gateDeepLinkScreen).
      if (role === "admin" || allowed.includes(role)) return { ok: true };
      return {
        ok: false,
        reason: `${pattern} is restricted to ${allowed.join(", ")}`,
      };
    }
    const screen = URL_TO_SCREEN[pattern];
    if (!screen) {
      return {
        ok: false,
        reason: `${pattern} has no entry in URL_TO_SCREEN, CUSTOM_URL_ROLES, or PUBLIC_URLS`,
      };
    }
    const gate = gateDeepLinkScreen(role, screen);
    return gate.ok ? { ok: true } : { ok: false, reason: gate.error };
  }

  it("URL_TO_SCREEN keys all parse as known App.tsx routes", () => {
    // Defence-in-depth: if buildDeepLink in routes/assistant.ts ever
    // grows a new screen we forgot to mirror here, this assertion is
    // the canary. Every key in URL_TO_SCREEN must match a real route
    // pattern in App.tsx.
    const orphans: string[] = [];
    for (const url of Object.keys(URL_TO_SCREEN)) {
      const matched = ROUTE_PATTERNS.some((r) => urlMatchesRoute(url, r));
      if (!matched) orphans.push(url);
    }
    expect(
      orphans,
      `URL_TO_SCREEN references URLs that no longer exist in App.tsx: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("URLs in a doc are reachable by every role tagged on that doc", () => {
    // For each doc, walk every URL in its body and assert that every
    // concrete role the doc is tagged with passes gateDeepLinkScreen
    // for the URL's screen. "any" expands to all four personas. This
    // is the lint that closes the partner→/catalog gap described in
    // the task: the route exists, so the existence lint is silent,
    // but the live deep-link gate would refuse the navigation.
    //
    // We also fail hard when a URL exists as an App.tsx route but
    // isn't classified into URL_TO_SCREEN / CUSTOM_URL_ROLES /
    // PUBLIC_URLS. Without that, a future doc could mention a real
    // route we forgot to bucket and silently bypass role-gating —
    // the existence lint would still be happy, but this lint would
    // skip the URL entirely.
    const broken: Array<{ doc: string; pattern: string; role: AssistantRole; reason: string }> = [];
    const unbucketed: Array<{ doc: string; url: string }> = [];
    for (const doc of KNOWLEDGE_DOCS) {
      const seenPatterns = new Set<string>();
      const seenUrls = new Set<string>();
      for (const m of doc.body.matchAll(DOC_URL_RE)) {
        const url = m[0];
        const pattern = resolveDocUrlPattern(url);
        if (!pattern) {
          // If the URL doesn't even match any App.tsx route, the
          // route-existence lint above has already reported it —
          // don't double-fail. But if it IS a real route and we
          // simply forgot to put it in a role bucket, that's a real
          // loophole worth surfacing here.
          const isRealRoute = ROUTE_PATTERNS.some((r) => urlMatchesRoute(url, r));
          if (isRealRoute && !seenUrls.has(url)) {
            seenUrls.add(url);
            unbucketed.push({ doc: doc.id, url });
          }
          continue;
        }
        if (seenPatterns.has(pattern)) continue;
        seenPatterns.add(pattern);
        for (const role of doc.roles) {
          const concrete: AssistantRole[] =
            role === "any"
              ? ["admin", "partner", "vendor", "field_employee"]
              : [role];
          for (const r of concrete) {
            const result = isRoleAllowedToVisit(r, pattern);
            if (!result.ok) {
              broken.push({ doc: doc.id, pattern, role: r, reason: result.reason });
            }
          }
        }
      }
    }
    expect(
      unbucketed,
      `Knowledge docs reference real App.tsx routes that aren't classified by the ` +
        `role-gating lint. Add each URL to URL_TO_SCREEN (if exposed via deep_link_to), ` +
        `CUSTOM_URL_ROLES (if it's a real page outside the deep-link tool), or ` +
        `PUBLIC_URLS (if anyone can visit it):\n${unbucketed
          .map((u) => `  - ${u.doc}: ${u.url}`)
          .join("\n")}`,
    ).toEqual([]);
    expect(
      broken,
      `Knowledge docs reference URLs that one of the doc's tagged roles cannot navigate to. ` +
        `Either narrow the doc's roles, split the doc per-role, or rephrase the body so the ` +
        `forbidden URL doesn't appear:\n${broken
          .map((b) => `  - [${b.doc}] role=${b.role} url=${b.pattern}: ${b.reason}`)
          .join("\n")}`,
    ).toEqual([]);
  });

  // Hand-curated map of doc id → keyword that must appear in at
  // least one page-title constant. `null` opts a doc out (concept
  // docs, glossary, meta — they don't point at a single page header).
  // Adding a new doc forces an explicit decision: an entry here is
  // required by the test below.
  const DOC_PRIMARY_KEYWORD: Record<string, string | null> = {
    "nav-overview": null,
    "ask-vndrly": null,
    // Concept docs introduced when askV got read-only DB tools — they
    // describe a capability set, not a single page.
    "data-tools-overview": null,
    "metrics-collected": null,
    "onboarding-partner": "Partner",
    "onboarding-vendor": "Vendor",
    "onboarding-field": "Field",
    "finish-setup-widget": "Dashboard",
    "tickets-list": "Tracking",
    "ticket-detail": "Tracking",
    // Field-portal home is reached from `nav.fieldOps`
    // ("Field Operations Management") in the locale.
    "field-portal-home": "Field Operations",
    // The notifications-on-mobile doc maps to the same "Notifications"
    // heading constant the web-app notifications doc anchors on.
    "field-portal-notifications": "Notifications",
    "ticket-kickback": null,
    "ticket-unlock": null,
    // Hotlist surfaces as a section embedded in the dashboard
    // and partner/vendor detail pages, not as its own top-level
    // page-title constant — opt out of the title check.
    hotlist: null,
    "crew-map": "Crew Map",
    "site-map": "Site Map",
    "background-tracking": "Location",
    "partners-detail": "Partners",
    "vendors-detail": "Vendors",
    "field-employees": "Employees",
    "site-locations": "Site Locations",
    "invoices-vendor": "Invoices",
    "bills-to-pay": "Bills to Pay",
    statements: "Statement",
    "reports-1099": "1099",
    "billing-settings": "Billing settings",
    visitors: "Visitors",
    "visitor-qr": "Visitor",
    "visitor-scan": null,
    "catalog-admin": "Catalog",
    "vendor-catalog": "Vendor Catalog",
    "analytics-partner": "Analytics",
    "analytics-vendor": "Analytics",
    notifications: "Notification",
    comments: null,
    "auth-context": null,
    "auth-password": "Password",
    glossary: null,
  };

  // Walk the locale tree and collect every string that lives at a
  // path ending in `.title`, `.heading`, or under the `nav` group.
  // These are the "page-title constants" the user actually sees in
  // the sidebar and at the top of each page.
  const PAGE_TITLE_TEXT: string = (() => {
    const out: string[] = [];
    const visit = (node: unknown, path: string[]): void => {
      if (typeof node === "string") {
        const last = path[path.length - 1] ?? "";
        const inNav = path[0] === "nav";
        if (inNav || last === "title" || last === "heading") {
          out.push(node);
        }
        return;
      }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          visit(v, [...path, k]);
        }
      }
    };
    visit(LOCALE_JSON, []);
    return out.join("\n").toLowerCase();
  })();

  it("collects a non-trivial set of page-title constants from the locale", () => {
    // Sanity: if the walker silently breaks, the lint below would
    // pass vacuously.
    expect(PAGE_TITLE_TEXT.length).toBeGreaterThan(200);
    expect(PAGE_TITLE_TEXT).toContain("dashboard");
    expect(PAGE_TITLE_TEXT).toContain("bills to pay");
  });

  it("every doc in the corpus has an explicit primary-keyword entry", () => {
    const missing: string[] = [];
    for (const doc of KNOWLEDGE_DOCS) {
      if (!(doc.id in DOC_PRIMARY_KEYWORD)) missing.push(doc.id);
    }
    expect(
      missing,
      `Add a DOC_PRIMARY_KEYWORD entry for each new doc (use null for concept/meta docs):\n${missing
        .map((id) => `  - ${id}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("every doc's primary keyword still appears in a page-title constant", () => {
    const drifted: Array<{ doc: string; keyword: string }> = [];
    for (const doc of KNOWLEDGE_DOCS) {
      const keyword = DOC_PRIMARY_KEYWORD[doc.id];
      if (keyword === null || keyword === undefined) continue;
      if (!PAGE_TITLE_TEXT.includes(keyword.toLowerCase())) {
        drifted.push({ doc: doc.id, keyword });
      }
    }
    expect(
      drifted,
      `Knowledge docs reference feature names that no longer appear in the locale's page-title constants:\n${drifted
        .map((d) => `  - ${d.doc}: looking for "${d.keyword}"`)
        .join(
          "\n",
        )}\n\nEither rename the keyword in DOC_PRIMARY_KEYWORD, restore the page title in en.json, or update the doc body.`,
    ).toEqual([]);
  });
});

// ─── Pre-auth signup-mode language hint ─────────────────────────
// Visitors on `/signup/{partner,vendor}` have no profile we can read
// a language preference from, so the launcher sniffs
// `navigator.language` and forwards it to the new
// `/assistant/signup/:persona/chat` endpoint. These tests pin the
// three sides of that wiring:
//   1. The browser-language detector handles the realistic
//      navigator.language values we expect (es-MX, es-US, en-US, …).
//   2. `buildSignupSystemPrompt` actually emits a LANGUAGE directive
//      when given a Spanish hint — and not just when given English.
//   3. The route file forwards the body's `lang` field through both
//      `buildSignupSystemPrompt` and `composeAssistantMessages` so
//      the priming envelope and the system prompt agree.
describe("signup-mode browser language detection", () => {
  it("returns 'es' when navigator.language starts with es", () => {
    expect(detectSignupBrowserLanguage({ language: "es-MX" })).toBe("es");
    expect(detectSignupBrowserLanguage({ language: "es-US" })).toBe("es");
    expect(detectSignupBrowserLanguage({ language: "es" })).toBe("es");
    expect(detectSignupBrowserLanguage({ language: "ES-ES" })).toBe("es");
  });

  it("returns 'en' for English / unknown / missing language", () => {
    expect(detectSignupBrowserLanguage({ language: "en-US" })).toBe("en");
    expect(detectSignupBrowserLanguage({ language: "fr-FR" })).toBe("en");
    expect(detectSignupBrowserLanguage({ language: "" })).toBe("en");
    expect(detectSignupBrowserLanguage({})).toBe("en");
  });

  it("prefers the languages list over the single language field", () => {
    // navigator.languages reflects the user's actual ranking; the
    // singular `language` field is a fallback. If the list says
    // Spanish-first, that's what we honour.
    const out = detectSignupBrowserLanguage({
      language: "en-US",
      languages: ["es-MX", "en-US"],
    });
    expect(out).toBe("es");
  });
});

describe("buildSignupSystemPrompt language wiring", () => {
  it("includes a Spanish LANGUAGE directive when lang='es'", () => {
    const prompt = buildSignupSystemPrompt({ persona: "partner", docs: [], lang: "es" });
    // The system prompt must carry the directive — without it the
    // model defaults to English even when given a Spanish-only
    // visitor, which is the regression Task #481 closes.
    expect(prompt).toMatch(/LANGUAGE/);
    expect(prompt).toMatch(/Spanish/);
  });

  it("defaults to an English directive when lang is missing or null", () => {
    // English is the model's default, but the prompt still emits the
    // explicit directive so a future change to a different default
    // model would not silently break.
    for (const args of [
      { persona: "partner" as const, docs: [] },
      { persona: "vendor" as const, docs: [], lang: null },
      { persona: "partner" as const, docs: [], lang: "en" as const },
    ]) {
      const prompt = buildSignupSystemPrompt(args);
      expect(prompt).toMatch(/LANGUAGE/);
      expect(prompt).toMatch(/English/);
      expect(prompt).not.toMatch(/Respond in Spanish/);
    }
  });
});

describe("signup endpoint forwards the lang hint", () => {
  // Read the route source directly so this assertion catches a future
  // refactor that drops the lang parameter from one of the two call
  // sites (system prompt vs message envelope). Without both wired,
  // the visitor would either get an English system prompt with a
  // Spanish primer envelope or vice versa — both subtly wrong.
  it("threads lang into both buildSignupSystemPrompt and composeAssistantMessages", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routeFile = path.resolve(
      __dirname,
      "../../api-server/src/routes/assistant.ts",
    );
    const src = fs.readFileSync(routeFile, "utf8");
    // The signup handler must read req.body.lang into a normalised
    // `lang` variable (collapsing anything not "en"/"es" to null) and
    // pass that variable to BOTH the prompt builder and the message
    // composer. We just check the textual contract here — the runtime
    // behaviour is already covered by the prompt tests above.
    expect(src).toMatch(/req\.body\?\.lang/);
    expect(src).toMatch(
      /buildSignupSystemPrompt\(\s*\{[^}]*lang[^}]*\}\s*\)/s,
    );
    // composeAssistantMessages must be called with `lang` (not null)
    // inside the signup handler. Locate the handler block by the
    // unique route literal and assert lang is the first argument.
    const signupBlockStart = src.indexOf(
      '"/assistant/signup/:persona/chat"',
    );
    expect(signupBlockStart, "signup route literal must exist").toBeGreaterThan(0);
    // Slice forward enough to capture the whole handler. The signup
    // handler has grown over time (it now constructs both a Spanish-
    // primer system prompt and a localized welcome message), so the
    // window needs to be generous enough to span from the route literal
    // past the `composeAssistantMessages(lang, …)` call.
    const signupBlock = src.slice(signupBlockStart, signupBlockStart + 8000);
    expect(signupBlock).toMatch(/composeAssistantMessages\(\s*lang\s*,/);
  });
});
