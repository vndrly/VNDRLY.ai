import i18next, { type TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import es from "./locales/es.json";

import { translateApiError } from "./api-error";

// ---------------------------------------------------------------------------
// Task #553 regression coverage: every Task #531 structured code emitted by
// the schedule and crew-tracker routes must translate to its Spanish copy
// when an office-app user has selected `es`. Without this guard a typo in
// a server code, a missing key in es.json, or a regression in api-error.ts
// would silently fall back to English copy or the generic fallback for
// Spanish-speaking dispatchers using the office web app.
//
// This test mirrors `artifacts/vndrly-mobile/lib/apiErrors.test.ts` so the
// two clients stay in sync as new structured codes are added.
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

describe("translateApiError — Task #531 Spanish coverage (office web)", () => {
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

// ---------------------------------------------------------------------------
// Task #568 regression coverage: the office web routes (auth, vendors,
// partners, invoices, reports, etc.) attach a structured `code` field
// alongside English `error` text:
//
//   res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" })
//
// translateApiError must prefer the structured `code` over the English
// `error` text so Spanish users see translated copy instead of the raw
// English fallback. Each code below MUST exist in both en.json and es.json.
// ---------------------------------------------------------------------------

const TASK_568_CODES = [
  "auth.invalid_credentials",
  "auth.not_authenticated",
  "auth.suspended",
  "auth.invalid_membership",
  "auth.missing_membership_id",
  "vendor.not_found",
  "partner.not_found",
  "invoice.not_found",
  "invoice.overpay",
  "members.cant_remove_self",
  "members.weak_password",
  "accounts.bad_id",
  "accounts.weak_password",
  "validation.invalid_input",
  "report.no_filable_rows",
  "onboarding.required_fields_missing",
  "assistant.message_too_long",
] as const;

describe("translateApiError — Task #568 web sign-in & account error codes", () => {
  it.each(TASK_568_CODES)(
    "translates %s to Spanish when delivered alongside English `error` text",
    async (code) => {
      const t = await makeI18n("es");
      const err = makeApiError({
        message: "ignored",
        status: 400,
        // Web routes ship the English text on `error` and the structured
        // code on `code`. The helper must prefer `code` for translation.
        data: { error: "Some English fallback text", code },
      });

      const expectedEs = lookup(es, `errors.${code}`);
      const expectedEn = lookup(en, `errors.${code}`);
      expect(expectedEs, `es.json missing errors.${code}`).toBeDefined();
      expect(expectedEn, `en.json missing errors.${code}`).toBeDefined();

      const translated = translateApiError(err, t);
      expect(translated).toBe(expectedEs);
      expect(translated).not.toBe("Some English fallback text");
    },
  );

  it("falls back to fallback when neither code nor error nor status matches a key", async () => {
    // No status → no status-family fallback either, so the helper drops
    // straight to the caller-supplied (already-translated) fallback.
    // Status-family fallbacks taking precedence over the caller fallback
    // is exercised by the Task #162 status-family suite below.
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "boom",
      data: { error: "Some unmapped English text", code: "no.such.code" },
    });
    expect(translateApiError(err, t, "Custom fallback")).toBe(
      "Custom fallback",
    );
  });
});

// ---------------------------------------------------------------------------
// Task #603 regression coverage: when the API rejects a duplicate vendor or
// partner name with a 409, it now ships a structured `details` payload (e.g.
// `{ name: "Acme" }`). translateApiError must forward those values to
// i18next as interpolation parameters so the EN/ES copy can render the
// conflicting name (`{{name}}`) instead of a bare generic "A vendor with
// that name already exists." string.
// ---------------------------------------------------------------------------

describe("translateApiError — Task #603 duplicate-name interpolation", () => {
  it.each([
    {
      lng: "en" as const,
      code: "vendor.duplicate_name",
      expected: 'A vendor named "Acme" already exists.',
    },
    {
      lng: "es" as const,
      code: "vendor.duplicate_name",
      expected: "Ya existe un proveedor llamado «Acme».",
    },
    {
      lng: "en" as const,
      code: "partner.duplicate_name",
      expected: 'A partner named "Globex" already exists.',
    },
    {
      lng: "es" as const,
      code: "partner.duplicate_name",
      expected: "Ya existe un socio llamado «Globex».",
    },
  ])(
    "interpolates {{name}} from data.details for $code in $lng",
    async ({ lng, code, expected }) => {
      const t = await makeI18n(lng);
      const conflictName = code.startsWith("vendor.") ? "Acme" : "Globex";
      const err = makeApiError({
        message: "ignored",
        status: 409,
        data: {
          error: `A ${code.split(".")[0]} named "${conflictName}" already exists.`,
          code,
          details: { name: conflictName },
        },
      });
      expect(translateApiError(err, t)).toBe(expected);
    },
  );

  it("ignores non-object details payloads safely", async () => {
    // A bogus `details: "string"` from a misbehaving client/server
    // shouldn't crash the helper — it should fall back to the
    // un-interpolated translation (which leaves `{{name}}` literal).
    const t = await makeI18n("en");
    const err = makeApiError({
      message: "ignored",
      status: 409,
      data: {
        error: "Duplicate vendor name",
        code: "vendor.duplicate_name",
        details: "not-an-object" as unknown as Record<string, unknown>,
      },
    });
    // Without interpolation, i18next leaves the placeholder verbatim.
    expect(translateApiError(err, t)).toBe(
      'A vendor named "{{name}}" already exists.',
    );
  });
});

// ---------------------------------------------------------------------------
// Task #162: status-family generic fallbacks for the office web app.
//
// Many older endpoints throw a raw English message via `data.error` /
// `err.message` without a structured `code`. Before Task #162 those
// rendered the English text verbatim to Spanish-speaking admins because
// `translateApiError()` had no generic copy to fall back to. The helper
// now mirrors the mobile `statusToKey()` table (401/403/404/409/422 +
// 4xx/5xx) so admins always see localised copy when the caller didn't
// supply its own already-translated fallback.
//
// This block locks the family table in place so a regression in
// `statusToKey()` or a missing key in either locale fails the build.
// ---------------------------------------------------------------------------

const STATUS_FAMILY_CASES = [
  { status: 401, key: "errors.unauthorized" },
  { status: 403, key: "errors.forbidden" },
  { status: 404, key: "errors.notFound" },
  { status: 409, key: "errors.conflict" },
  { status: 422, key: "errors.validationFailed" },
  { status: 400, key: "errors.badRequest" },
  { status: 418, key: "errors.badRequest" },
  { status: 500, key: "errors.server.internal_error" },
  { status: 503, key: "errors.server.internal_error" },
] as const;

describe("translateApiError — Task #162 status-family fallbacks (office web)", () => {
  it.each(STATUS_FAMILY_CASES)(
    "uses Spanish $key for status $status when no structured code is present",
    async ({ status, key }) => {
      const t = await makeI18n("es");
      const err = makeApiError({
        // Raw English text from a legacy endpoint — must NOT be shown
        // to a Spanish-speaking admin.
        message: "Some raw English message from the server",
        status,
      });

      const expectedEs = lookup(es, key);
      expect(expectedEs, `es.json missing ${key}`).toBeDefined();
      expect(translateApiError(err, t)).toBe(expectedEs);
    },
  );

  it("prefers a translated structured code over the status-family fallback", async () => {
    // If the server attached a structured code, that wins — the family
    // fallback is only for endpoints that returned bare English text.
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "ignored",
      status: 404,
      data: { code: "vendor.not_found", error: "Vendor not found" },
    });
    expect(translateApiError(err, t)).toBe(lookup(es, "errors.vendor.not_found"));
  });

  it("uses the caller-supplied fallback when the error has no status family", async () => {
    // When the caller passes a fallback it's already localized via
    // i18next (the caller does the translation lookup before passing
    // the string in). With no status to map, the helper drops straight
    // to that pre-translated fallback instead of returning err.message
    // verbatim or the generic unknownError copy.
    const t = await makeI18n("es");
    const err = makeApiError({ message: "boom" });
    expect(translateApiError(err, t, "Falla específica del llamador")).toBe(
      "Falla específica del llamador",
    );
  });

  it("falls back to errors.unknownError when nothing else matches", async () => {
    // No status, no code, no caller fallback, no message → `unknownError`.
    const t = await makeI18n("es");
    const err = new Error("");
    expect(translateApiError(err, t)).toBe(lookup(es, "errors.unknownError"));
  });

  it("recognises a top-level err.code on the error object", async () => {
    // AuthApiError (and any other custom Error subclass) hoists the
    // structured code onto the error itself rather than `data.code`.
    // The helper must honour both, mirroring the mobile shape.
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "ignored",
      status: 401,
      code: "auth.invalid_credentials",
      data: { error: "Invalid credentials" },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.auth.invalid_credentials"),
    );
  });
});

describe("translateApiError — Task #162 network-failure detection (office web)", () => {
  // Browser/runtime fetch rejections come back with no HTTP status
  // because nothing reached the server. The helper detects those by
  // shape (TypeError, "Failed to fetch", etc.) and renders the generic
  // `errors.network.unreachable` copy in the user's language.
  it.each([
    { name: "TypeError", message: "Failed to fetch" },
    { name: "TypeError", message: "NetworkError when attempting to fetch resource." },
    { name: "Error", message: "fetch failed" },
    { name: "Error", message: "Network request failed" },
  ])(
    "translates a $name with message $message as errors.network.unreachable",
    async ({ name, message }) => {
      const t = await makeI18n("es");
      const err = new Error(message);
      err.name = name;
      const expectedEs = lookup(es, "errors.network.unreachable");
      expect(translateApiError(err, t)).toBe(expectedEs);
    },
  );

  it("does NOT treat a TypeError WITH a status as a network error", async () => {
    // If the wrapper attached an HTTP status, the request reached the
    // server — fall through to the status-family fallback instead of
    // pretending the network was down.
    const t = await makeI18n("es");
    const err = makeApiError({
      message: "Failed to fetch",
      status: 500,
    });
    err.name = "TypeError";
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.server.internal_error"),
    );
  });
});

// ---------------------------------------------------------------------------
// Task #162: axios-style nested-response error shape coverage.
//
// `translateApiError` accepts both fetch-style errors (`err.status`,
// `err.data`) AND legacy axios-style errors (`err.response.status`,
// `err.response.data`). Without this coverage a regression in the
// status normalizer would silently drop legacy errors back to raw
// English copy, which is precisely the bug Task #162 set out to fix.
// ---------------------------------------------------------------------------

function makeAxiosError(init: {
  message: string;
  response?: { status?: number; data?: Record<string, unknown> | null };
  name?: string;
}): Error {
  const err = new Error(init.message) as Error & {
    response?: { status?: number; data?: unknown };
  };
  if (init.response !== undefined) err.response = init.response;
  if (init.name) err.name = init.name;
  return err;
}

describe("translateApiError — Task #162 axios-style nested response shape", () => {
  it.each(STATUS_FAMILY_CASES)(
    "uses Spanish $key for nested response.status $status when no code is present",
    async ({ status, key }) => {
      const t = await makeI18n("es");
      const err = makeAxiosError({
        message: "Some raw English message from the server",
        response: { status, data: { error: "Some raw English text" } },
      });
      const expectedEs = lookup(es, key);
      expect(translateApiError(err, t)).toBe(expectedEs);
    },
  );

  it("prefers a structured code from response.data.code over the family fallback", async () => {
    // The body's `code` wins over a generic 4xx — same precedence as
    // the fetch-style shape, just one level deeper.
    const t = await makeI18n("es");
    const err = makeAxiosError({
      message: "ignored",
      response: {
        status: 404,
        data: { code: "vendor.not_found", error: "Vendor not found" },
      },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.vendor.not_found"),
    );
  });

  it("recognises a structured code from response.data.error (legacy field)", async () => {
    // Some axios callsites still ship the snake_case code in `error`
    // rather than `code` — the structured-code shape guard must
    // accept both even when nested under `response.data`.
    const t = await makeI18n("es");
    const err = makeAxiosError({
      message: "ignored",
      response: { status: 400, data: { error: "schedule.not_scheduled" } },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.schedule.not_scheduled"),
    );
  });

  it("treats an axios-style TypeError with no nested status as a network error", async () => {
    // When axios fails before sending (no internet, DNS, etc.) it
    // throws without a `.response` at all — same network-fallback
    // copy as the fetch-style equivalent.
    const t = await makeI18n("es");
    const err = makeAxiosError({
      name: "TypeError",
      message: "Network Error",
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.network.unreachable"),
    );
  });

  it("does NOT treat an axios-style error WITH a nested status as a network error", async () => {
    // Even if the message looks network-y, a 5xx status proves the
    // request reached the server — fall through to the status-family
    // fallback instead of the network copy.
    const t = await makeI18n("es");
    const err = makeAxiosError({
      name: "TypeError",
      message: "Network Error",
      response: { status: 502 },
    });
    expect(translateApiError(err, t)).toBe(
      lookup(es, "errors.server.internal_error"),
    );
  });
});
