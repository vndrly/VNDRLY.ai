import i18next, { type TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import es from "./locales/es.json";

import {
  ALL_VISIT_ERROR_CODES,
  OFF_GEOFENCE,
  VISIT_ERROR_CODES,
  isAnyVisitErrorCode,
  isVisitErrorCode,
} from "@workspace/visit-error-codes";

import {
  getApiErrorCode,
  inlineErrorForTicketAction,
  inlineFieldErrors,
  isValidationFailedError,
  translateApiError,
  translateValidationIssues,
  translateVisitError,
  translateZodIssue,
} from "./apiErrors";
import {
  VALIDATION_FAILED,
  type ZodIssueWire,
} from "@workspace/zod-validation-issues";

// Minimal i18next-like translator that mirrors how react-i18next behaves
// with missing keys: returns the key string if not found, or the
// interpolated value if found. Codes that have a translation are listed
// in `dict`; everything else falls through to "key returned verbatim",
// which translateApiError() treats as "not found".
function makeT(dict: Record<string, string>) {
  return ((key: string, opts?: Record<string, unknown>) => {
    const tmpl = dict[key];
    if (tmpl == null) return key;
    if (opts) {
      return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) =>
        String((opts as Record<string, unknown>)[k] ?? ""),
      );
    }
    return tmpl;
  }) as unknown as Parameters<typeof translateApiError>[1];
}

function makeApiError(init: {
  message: string;
  status?: number;
  code?: string;
  data?: Record<string, unknown> | null;
}): Error {
  const err = new Error(init.message) as Error & {
    status?: number;
    code?: string;
    data?: unknown;
  };
  if (init.status != null) err.status = init.status;
  if (init.code != null) err.code = init.code;
  if (init.data !== undefined) err.data = init.data;
  return err;
}

describe("getApiErrorCode", () => {
  it("returns err.code when present and code-shaped", () => {
    expect(getApiErrorCode(makeApiError({ message: "x", code: "off_geofence" })))
      .toBe("off_geofence");
  });

  it("falls back to err.data.code when err.code is missing", () => {
    expect(
      getApiErrorCode(
        makeApiError({ message: "x", data: { code: "field.account_inactive" } }),
      ),
    ).toBe("field.account_inactive");
  });

  it("falls back to err.data.error (Task #517 convention)", () => {
    // The office POST /tickets endpoint returns
    // { error: "site_not_found", message: "Site not found." } — `error`
    // is the structured code and `message` is human copy.
    expect(
      getApiErrorCode(
        makeApiError({
          message: "Site not found.",
          status: 400,
          data: { error: "site_not_found", message: "Site not found." },
        }),
      ),
    ).toBe("site_not_found");
  });

  it("ignores English-sentence error fields (no spaces, all lowercase)", () => {
    // Legacy endpoints still emit `{ error: "Site not found" }` — that's
    // a sentence, not an identifier, and must NOT be treated as a code.
    expect(
      getApiErrorCode(
        makeApiError({
          message: "Site not found",
          status: 404,
          data: { error: "Site not found" },
        }),
      ),
    ).toBeNull();
  });

  it("returns null for non-Error inputs", () => {
    expect(getApiErrorCode(null)).toBeNull();
    expect(getApiErrorCode("oops")).toBeNull();
    expect(getApiErrorCode(undefined)).toBeNull();
  });
});

describe("translateApiError", () => {
  it("uses the structured code for new endpoints (err.data.error)", () => {
    const t = makeT({
      "errors.site_not_found": "We couldn't find that site.",
    });
    const err = makeApiError({
      message: "Site not found.",
      status: 400,
      data: { error: "site_not_found", message: "Site not found." },
    });
    expect(translateApiError(err, t)).toBe("We couldn't find that site.");
  });

  it("renders all five Task #509/#517 codes from err.data.error", () => {
    const t = makeT({
      "errors.site_not_found": "site_not_found_es",
      "errors.site_vendor_mismatch": "site_vendor_mismatch_es",
      "errors.work_type_not_allowed": "work_type_not_allowed_es",
      "errors.foreman_vendor_mismatch": "foreman_vendor_mismatch_es",
      "errors.foreman_field_employee_mismatch": "foreman_fe_mismatch_es",
    });
    for (const code of [
      "site_not_found",
      "site_vendor_mismatch",
      "work_type_not_allowed",
      "foreman_vendor_mismatch",
      "foreman_field_employee_mismatch",
    ] as const) {
      const err = makeApiError({
        message: "anything",
        status: 400,
        data: { error: code },
      });
      expect(translateApiError(err, t)).not.toBe("anything");
    }
  });

  it("interpolates off_geofence with distance and radius", () => {
    const t = makeT({
      "tickets.offGeofence":
        "You're {{distance}}m away — must be within {{radius}}m.",
    });
    const err = makeApiError({
      message: "Off geofence",
      status: 400,
      data: { code: OFF_GEOFENCE, distanceMeters: 320, radiusMeters: 150 },
    });
    expect(translateApiError(err, t)).toBe(
      "You're 320m away — must be within 150m.",
    );
  });

  it("translates the structured code emitted by crew.ts / ticketSchedule.ts", () => {
    // Task #558: every res.json in those routes now attaches a stable
    // `code` field (e.g. `auth.not_authenticated`, `ticket.not_found`),
    // so the code-based lookup handles them and the legacy English-string
    // fallback map (KNOWN_ENGLISH_MESSAGES) is gone.
    const t = makeT({
      "errors.ticket.not_found": "No se encontró el ticket.",
      "errors.auth.not_authenticated": "Inicia sesión para continuar.",
    });
    const ticketErr = makeApiError({
      message: "Ticket not found",
      status: 404,
      code: "ticket.not_found",
      data: { error: "Ticket not found", code: "ticket.not_found" },
    });
    expect(translateApiError(ticketErr, t)).toBe("No se encontró el ticket.");
    const authErr = makeApiError({
      message: "Not authenticated",
      status: 401,
      code: "auth.not_authenticated",
      data: { error: "Not authenticated", code: "auth.not_authenticated" },
    });
    expect(translateApiError(authErr, t)).toBe("Inicia sesión para continuar.");
  });

  it("falls back to status-family translation when nothing else matches", () => {
    const t = makeT({
      "errors.unauthorized": "Inicia sesión.",
    });
    const err = makeApiError({ message: "anything", status: 401 });
    expect(translateApiError(err, t)).toBe("Inicia sesión.");
  });

  it("uses the caller-supplied translated fallback as a last resort", () => {
    const t = makeT({});
    const err = makeApiError({ message: "" });
    expect(translateApiError(err, t, "Failed to create tickets")).toBe(
      "Failed to create tickets",
    );
  });

  it("forwards err.data.details into i18next as interpolation values", () => {
    // Task #458: the public mobile/web vendor self-signup endpoint
    // (POST /onboarding/vendor) returns
    // `{ code: "vendor.duplicate_name", details: { name: "Acme Inc." } }`
    // when the proposed name canonicalizes to an existing vendor. The
    // EN/ES copy renders `{{name}}`, so translateApiError must forward
    // `details` into i18next, mirroring the web's translateApiError.
    const t = makeT({
      "errors.vendor.duplicate_name":
        'A vendor named "{{name}}" already exists.',
    });
    const err = makeApiError({
      message: 'A vendor named "Acme Inc." already exists.',
      status: 409,
      data: {
        code: "vendor.duplicate_name",
        details: { name: "Acme Inc." },
      },
    });
    expect(translateApiError(err, t)).toBe(
      'A vendor named "Acme Inc." already exists.',
    );
  });

  it("ignores non-object details payloads when interpolating", () => {
    // Defensive: if a buggy server emits `details: "string"` (or an
    // array), translateApiError still returns the translated key
    // unchanged instead of crashing, leaving the `{{name}}` placeholder
    // visible. The signup screen never relies on placeholder rendering
    // for correctness; it just needs translateApiError to be robust.
    const t = makeT({
      "errors.vendor.duplicate_name":
        'A vendor named "{{name}}" already exists.',
    });
    const err = makeApiError({
      message: "x",
      status: 409,
      data: {
        code: "vendor.duplicate_name",
        details: "Acme Inc." as unknown as Record<string, unknown>,
      },
    });
    // The placeholder remains because no interpolation values were
    // forwarded, but translation still succeeded.
    expect(translateApiError(err, t)).toBe(
      'A vendor named "{{name}}" already exists.',
    );
  });
});

describe("inlineErrorForTicketAction (Task #532)", () => {
  it("pins the error to the preferred field for non-conflict codes", () => {
    const t = makeT({
      "errors.forbidden_not_invited_vendor":
        "Only the invited vendor can act on this ticket.",
    });
    const err = makeApiError({
      message: "Only the invited vendor can act on this ticket.",
      status: 403,
      data: { error: "forbidden_not_invited_vendor" },
    });
    const result = inlineErrorForTicketAction(err, t, "accept", "fallback");
    expect(result).toEqual({
      field: "accept",
      message: "Only the invited vendor can act on this ticket.",
      isStateConflict: false,
    });
  });

  it("flags ticket_not_awaiting_acceptance as a state conflict so the screen refreshes", () => {
    // The accept-error path the task explicitly calls out: a foreman
    // taps Accept on a ticket the partner has already cancelled or
    // re-routed. The mobile UI should refresh instead of pinning a
    // stale message under a button that may disappear post-refresh.
    const t = makeT({
      "errors.ticket_not_awaiting_acceptance":
        "This invite has already been responded to.",
    });
    const err = makeApiError({
      message: "This invite has already been responded to.",
      status: 409,
      data: { error: "ticket_not_awaiting_acceptance" },
    });
    const result = inlineErrorForTicketAction(err, t, "accept", "fallback");
    expect(result.isStateConflict).toBe(true);
    expect(result.field).toBe("accept");
    expect(result.message).toBe("This invite has already been responded to.");
  });

  it("flags ticket_state_changed as a state conflict regardless of preferred field", () => {
    const t = makeT({
      "errors.ticket_state_changed":
        "Ticket state changed — please refresh and try again.",
    });
    const err = makeApiError({
      message: "anything",
      status: 409,
      data: { error: "ticket_state_changed" },
    });
    for (const field of ["accept", "deny", "en_route", "check_in", "check_out", "close"] as const) {
      expect(inlineErrorForTicketAction(err, t, field, "fallback").isStateConflict)
        .toBe(true);
    }
  });

  it("re-routes foreman_vendor_mismatch to the crew picker", () => {
    // The schedule endpoint returns this when a foreman picked from the
    // dropdown isn't actually a member of the ticket's vendor. Mirroring
    // the web's `inlineErrorFor()` logic, the message belongs on the
    // picker even if it surfaces from a different mutation.
    const t = makeT({
      "errors.foreman_vendor_mismatch":
        "That foreman isn't on this vendor. Pick a different field employee.",
    });
    const err = makeApiError({
      message: "Foreman vendor mismatch",
      status: 400,
      data: { error: "foreman_vendor_mismatch" },
    });
    const result = inlineErrorForTicketAction(err, t, "check_in", "fallback");
    expect(result.field).toBe("crew_picker");
    expect(result.isStateConflict).toBe(false);
  });

  it("re-routes foreman_field_employee_mismatch and field_employee_vendor_mismatch", () => {
    const t = makeT({
      "errors.foreman_field_employee_mismatch":
        "Foreman must match the assigned field employee.",
      "errors.field_employee_vendor_mismatch":
        "Field employee not on this vendor.",
    });
    for (const code of [
      "foreman_field_employee_mismatch",
      "field_employee_vendor_mismatch",
    ] as const) {
      const err = makeApiError({
        message: "x",
        status: 400,
        data: { error: code },
      });
      expect(inlineErrorForTicketAction(err, t, "accept", "fallback").field)
        .toBe("crew_picker");
    }
  });

  it("uses the caller's fallback when the error has no translation", () => {
    const t = makeT({});
    const err = makeApiError({ message: "" });
    const result = inlineErrorForTicketAction(err, t, "check_in", "Couldn't check in");
    expect(result.message).toBe("Couldn't check in");
    expect(result.field).toBe("check_in");
    expect(result.isStateConflict).toBe(false);
  });

  it("flags ticket_not_in_progress as a state conflict and pins to awaiting_payment", () => {
    // Task #575: a foreman taps "Awaiting payment" on a ticket that another
    // device just submitted for review (so the server-side state has moved
    // out of in_progress). The button is about to disappear after the
    // refresh, so we silently reload instead of pinning a stale error
    // under a control that may no longer be there. The preferredField
    // (`awaiting_payment`) must still be preserved on the result so the
    // caller can clear any matching inline error during the refresh.
    const t = makeT({
      "errors.ticket_not_in_progress":
        "Only an in-progress ticket can be marked awaiting payment.",
    });
    const err = makeApiError({
      message: "Only an in-progress ticket can be marked awaiting payment.",
      status: 409,
      data: { error: "ticket_not_in_progress" },
    });
    const result = inlineErrorForTicketAction(
      err,
      t,
      "awaiting_payment",
      "fallback",
    );
    expect(result).toEqual({
      field: "awaiting_payment",
      message: "Only an in-progress ticket can be marked awaiting payment.",
      isStateConflict: true,
    });
  });

  it("flags crew.not_on_roster as a state conflict so the roster refreshes", () => {
    // Task #561: a foreman taps × on a chip that another device (or this
    // device, racing) just removed from the roster. The DELETE roster
    // route returns code "crew.not_on_roster" — the chip should silently
    // disappear on refresh, not pin a "not on roster" error under itself.
    const t = makeT({
      "errors.crew.not_on_roster": "That crew member isn't on the roster.",
    });
    const err = makeApiError({
      message: "Crew member not on roster",
      status: 404,
      code: "crew.not_on_roster",
    });
    const result = inlineErrorForTicketAction(err, t, "crew_picker", "fallback");
    expect(result.isStateConflict).toBe(true);
    expect(result.message).toBe("That crew member isn't on the roster.");
  });
});

// ---------------------------------------------------------------------------
// Task #531 regression coverage: every structured code added for the schedule
// and crew-tracker routes must translate to its Spanish copy when the user's
// locale is `es`. Without this guard, a typo in a server code, a missing key
// in es.json, or a removed mapping in apiErrors.ts would silently fall back
// to English copy for Spanish-speaking field employees.
// ---------------------------------------------------------------------------

// All codes added in Task #531. Keep this list in sync with the server-side
// error code emission in `routes/ticketSchedule.ts` and `routes/crew.ts`
// (and the corresponding `errors.*` keys in en.json / es.json).
const TASK_531_CODES = [
  "schedule.start_required",
  "schedule.invalid_duration",
  "schedule.invalid_crew",
  "schedule.invalid_foreman",
  "schedule.invalid_ack_status",
  "schedule.not_on_crew",
  "schedule.not_assigned",
  "schedule.not_scheduled",
  "crew.already_checked_in",
  "crew.no_open_check_in",
  "crew.session_not_found",
  "crew.reason_required",
  "crew.already_on_roster",
  "crew.not_on_roster",
  "crew.assignment_rate_role",
  "crew.invalid_hourly_rate",
  "employee.not_found",
  "employee.vendor_mismatch",
  "validation.invalid_id",
  "validation.invalid_employee_id",
  "validation.invalid_at",
  "work_type.not_found",
  "weather.upstream_error",
  "site.missing_coordinates",
] as const;

// Resolve a dot-notation key (e.g. "errors.schedule.start_required") against
// the raw locale JSON, so we can independently compute the expected Spanish
// (and English) copy without relying on i18next's own lookup logic.
function lookup(
  resources: Record<string, unknown>,
  dotted: string,
): string | undefined {
  const parts = dotted.split(".");
  let cur: unknown = resources;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

async function makeI18n(lng: "en" | "es"): Promise<TFunction> {
  // Create an isolated i18next instance per test so we don't pollute the
  // singleton used by the running app (and so language is deterministic).
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
  });
  return instance.t.bind(instance) as TFunction;
}

describe("translateApiError — Task #531 Spanish coverage", () => {
  it.each(TASK_531_CODES)(
    "translates %s to Spanish for es locale",
    async (code) => {
      const t = await makeI18n("es");
      const err = makeApiError({
        message: "ignored — should be replaced by translation",
        status: 400,
        data: { code },
      });

      const expectedEs = lookup(es, `errors.${code}`);
      const expectedEn = lookup(en, `errors.${code}`);

      // Sanity: both locale files must define the key. If this fails the
      // test author needs to add the key to both en.json and es.json.
      expect(expectedEs, `es.json missing errors.${code}`).toBeDefined();
      expect(expectedEn, `en.json missing errors.${code}`).toBeDefined();

      const translated = translateApiError(err, t);

      // The Spanish copy must be returned verbatim — not the raw key, not
      // the English fallback, not the original error message.
      expect(translated).toBe(expectedEs);
      expect(translated).not.toBe(`errors.${code}`);
      expect(translated).not.toBe(expectedEn);
      expect(translated).not.toBe(
        "ignored — should be replaced by translation",
      );
    },
  );

  // Task #550: every code in the shared `VISIT_ERROR_CODES` union must
  // have a translation in BOTH en.json and es.json. If the server adds a
  // new visit error code (via the typed lib) but the locale files still
  // lack the matching `errors.<code>` entry, the mobile app would
  // silently fall back to the generic status-family copy
  // ("The request couldn't be processed…"). Failing the build here
  // forces the locale update to land alongside the new code.
  describe("@workspace/visit-error-codes locale parity (Task #550)", () => {
    it.each(VISIT_ERROR_CODES)(
      "%s has en + es translations",
      (code) => {
        const enCopy = lookup(en, `errors.${code}`);
        const esCopy = lookup(es, `errors.${code}`);
        expect(enCopy, `en.json missing errors.${code}`).toBeDefined();
        expect(esCopy, `es.json missing errors.${code}`).toBeDefined();
      },
    );

    it("translateVisitError() returns the en string for each visit code", async () => {
      const t = await makeI18n("en");
      for (const code of VISIT_ERROR_CODES) {
        const expected = lookup(en, `errors.${code}`);
        expect(translateVisitError(code, t)).toBe(expected);
      }
    });

    // OFF_GEOFENCE is the one visit-flow code that does NOT resolve
    // through the generic `errors.<code>` path — it goes through a
    // dedicated `tickets.offGeofence` branch with distance/radius
    // interpolation. It must therefore live in `ALL_VISIT_ERROR_CODES`
    // (so it stays a member of the typed visit-flow union and a typo
    // anywhere — server, mobile, or web — fails the build) but be
    // EXCLUDED from `VISIT_ERROR_CODES` (so the locale-parity check
    // above doesn't demand a non-existent `errors.off_geofence` key).
    it("OFF_GEOFENCE keeps its on-the-wire literal string", () => {
      expect(OFF_GEOFENCE).toBe("off_geofence");
    });

    it("OFF_GEOFENCE is in ALL_VISIT_ERROR_CODES but not VISIT_ERROR_CODES", () => {
      expect(ALL_VISIT_ERROR_CODES).toContain(OFF_GEOFENCE);
      expect(VISIT_ERROR_CODES as readonly string[]).not.toContain(
        OFF_GEOFENCE,
      );
    });

    it("isAnyVisitErrorCode accepts OFF_GEOFENCE; isVisitErrorCode rejects it", () => {
      expect(isAnyVisitErrorCode(OFF_GEOFENCE)).toBe(true);
      expect(isVisitErrorCode(OFF_GEOFENCE)).toBe(false);
      expect(isAnyVisitErrorCode("not_a_code")).toBe(false);
    });

    it("tickets.offGeofence interpolation key exists in en + es", () => {
      expect(lookup(en, "tickets.offGeofence")).toBeDefined();
      expect(lookup(es, "tickets.offGeofence")).toBeDefined();
    });
  });

  it("also resolves Task #531 codes when delivered via err.data.error (legacy field)", async () => {
    // Several routes still attach the structured code on `data.error`
    // rather than `data.code` (Task #517 convention). The same Spanish
    // copy must come out either way.
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "anything",
      status: 400,
      data: { error: "schedule.not_scheduled" },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.schedule.not_scheduled"),
    );
  });
});

// ── Task #164: structured Zod validation issue translation ──

function makeValidationFailedError(issues: ZodIssueWire[]): Error {
  return makeApiError({
    message: "Validation failed",
    status: 400,
    data: {
      code: VALIDATION_FAILED,
      error: VALIDATION_FAILED,
      message: "Validation failed",
      issues,
    },
  });
}

describe("translateZodIssue (Task #164)", () => {
  it("treats invalid_type with received='undefined' as required (Spanish)", async () => {
    const t = await makeI18n("es");
    const issue: ZodIssueWire = {
      code: "invalid_type",
      path: ["email"],
      message: "Required",
      expected: "string",
      received: "undefined",
    };
    expect(translateZodIssue(issue, t)).toBe(
      lookup(es, "errors.validation.issues.required"),
    );
  });

  it("treats invalid_type with received='null' as required (English)", async () => {
    const t = await makeI18n("en");
    const issue: ZodIssueWire = {
      code: "invalid_type",
      path: ["name"],
      message: "Expected string, received null",
      expected: "string",
      received: "null",
    };
    expect(translateZodIssue(issue, t)).toBe(
      lookup(en, "errors.validation.issues.required"),
    );
  });

  it("translates invalid_string + email as the email-specific Spanish key", async () => {
    const t = await makeI18n("es");
    const issue: ZodIssueWire = {
      code: "invalid_string",
      path: ["email"],
      message: "Invalid email",
      validation: "email",
    };
    expect(translateZodIssue(issue, t)).toBe(
      lookup(es, "errors.validation.issues.invalid_string_email"),
    );
  });

  it("interpolates {{minimum}} for too_small on a string (Spanish)", async () => {
    const t = await makeI18n("es");
    const issue: ZodIssueWire = {
      code: "too_small",
      path: ["password"],
      message: "Should be at least 8 characters",
      type: "string",
      minimum: 8,
      inclusive: true,
    };
    const out = translateZodIssue(issue, t);
    expect(out).toContain("8");
    expect(out).toBe(
      (lookup(es, "errors.validation.issues.too_small_string") ?? "").replace(
        "{{minimum}}",
        "8",
      ),
    );
  });

  it("interpolates {{maximum}} for too_big on a number (English)", async () => {
    const t = await makeI18n("en");
    const issue: ZodIssueWire = {
      code: "too_big",
      path: ["quantity"],
      message: "Number must be less than or equal to 99",
      type: "number",
      maximum: 99,
      inclusive: true,
    };
    const out = translateZodIssue(issue, t);
    expect(out).toContain("99");
    expect(out).toBe(
      (lookup(en, "errors.validation.issues.too_big_number") ?? "").replace(
        "{{maximum}}",
        "99",
      ),
    );
  });

  it("falls back to the issues.default key when the code is unknown", async () => {
    const t = await makeI18n("es");
    const issue: ZodIssueWire = {
      code: "brand_new_code_that_doesnt_exist_yet" as ZodIssueWire["code"],
      path: ["x"],
      message: "Something",
    };
    expect(translateZodIssue(issue, t)).toBe(
      lookup(es, "errors.validation.issues.default"),
    );
  });
});

describe("translateValidationIssues + inlineFieldErrors (Task #164)", () => {
  it("returns one descriptor per issue with the top-level field name", async () => {
    const t = await makeI18n("es");
    const err = makeValidationFailedError([
      {
        code: "invalid_string",
        path: ["email"],
        message: "Invalid email",
        validation: "email",
      },
      {
        code: "too_small",
        path: ["password"],
        message: "Too short",
        type: "string",
        minimum: 8,
        inclusive: true,
      },
    ]);
    const descs = translateValidationIssues(err, t);
    expect(descs).toHaveLength(2);
    expect(descs[0]).toMatchObject({ field: "email", pathKey: "email" });
    expect(descs[1]).toMatchObject({ field: "password", pathKey: "password" });
    expect(descs[0]?.message).toBe(
      lookup(es, "errors.validation.issues.invalid_string_email"),
    );
    expect(descs[1]?.message).toContain("8");
  });

  it("preserves nested paths (e.g. addresses.0.zip)", async () => {
    const t = await makeI18n("en");
    const err = makeValidationFailedError([
      {
        code: "invalid_string",
        path: ["addresses", 0, "zip"],
        message: "Invalid zip",
        validation: "regex",
      },
    ]);
    const descs = translateValidationIssues(err, t);
    expect(descs).toHaveLength(1);
    expect(descs[0]?.field).toBe("addresses");
    expect(descs[0]?.pathKey).toBe("addresses.0.zip");
  });

  it("returns empty array when the error isn't a structured validation failure", async () => {
    const t = await makeI18n("en");
    const err = makeApiError({
      message: "Boom",
      status: 500,
      data: { error: "internal" },
    });
    expect(translateValidationIssues(err, t)).toEqual([]);
    expect(inlineFieldErrors(err, t)).toEqual({});
  });

  it("inlineFieldErrors keys by top-level field name", async () => {
    const t = await makeI18n("en");
    const err = makeValidationFailedError([
      {
        code: "invalid_type",
        path: ["email"],
        message: "Required",
        expected: "string",
        received: "undefined",
      },
      {
        code: "too_small",
        path: ["password"],
        message: "Too short",
        type: "string",
        minimum: 8,
        inclusive: true,
      },
    ]);
    const map = inlineFieldErrors(err, t);
    expect(map.email).toBe(lookup(en, "errors.validation.issues.required"));
    expect(map.password).toContain("8");
  });

  it("isValidationFailedError detects the structured shape", () => {
    const validationErr = makeValidationFailedError([
      {
        code: "invalid_type",
        path: ["x"],
        message: "Required",
        expected: "string",
        received: "undefined",
      },
    ]);
    expect(isValidationFailedError(validationErr)).toBe(true);

    const semanticErr = makeApiError({
      message: "Site not found",
      status: 404,
      data: { error: "site_not_found" },
    });
    expect(isValidationFailedError(semanticErr)).toBe(false);
  });
});

describe("translateApiError joins issue messages for validation.failed (Task #164)", () => {
  it("renders translated, joined per-issue copy in Spanish", async () => {
    const t = await makeI18n("es");
    const err = makeValidationFailedError([
      {
        code: "invalid_string",
        path: ["email"],
        message: "Invalid email",
        validation: "email",
      },
      {
        code: "too_small",
        path: ["password"],
        message: "Too short",
        type: "string",
        minimum: 8,
        inclusive: true,
      },
    ]);
    const out = translateApiError(err, t);
    expect(out).toContain(
      lookup(es, "errors.validation.issues.invalid_string_email") ?? "__missing__",
    );
    expect(out).toContain("8");
    // Banner should NOT be raw English from the server.
    expect(out).not.toContain("Invalid email");
    expect(out).not.toContain("Too short");
  });

  it("falls back to the generic validation.failed banner when issues is empty", async () => {
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "Validation failed",
      status: 400,
      data: { code: VALIDATION_FAILED, error: VALIDATION_FAILED, issues: [] },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.validation.failed"),
    );
  });
});
