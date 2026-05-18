import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  UpdateVendorPartnerBillingSettingsBody,
  IncomeCategoryOverridesSchema,
} from "@workspace/api-zod";
import {
  INVOICE_LINE_TYPES,
  INVOICE_LINE_INCOME_CATEGORIES,
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";

// ---------------------------------------------------------------------------
// Task #408 — Reject invalid 1099 categories before they reach the database.
//
// The per-(vendor, partner) `default_income_category_overrides` map drives
// which 1099 box every freshly emitted invoice line lands in. A typo
// ("misc_royaltys" vs "misc_royalties") or a stale enum value would silently
// flow through invoice regeneration and end up persisted on every line —
// invisible to the admin until tax time. The save endpoint must therefore
// reject unknown values at the API boundary, and that validation lives in
// the shared `@workspace/api-zod` schema so the web UI and any future
// mobile/admin client share the same contract.
//
// These tests cover BOTH layers:
//
//   1. The shared zod schema itself accepts every canonical
//      INVOICE_LINE_TYPES → INVOICE_LINE_INCOME_CATEGORIES pair, and rejects
//      a typo like { equipment: "not_a_real_box" }.
//   2. A minimal express app that mounts only the body-parse path of the
//      `PUT /invoices/vendor-partner-billing-settings` handler returns 400
//      with `code: "validation.invalid_input"` for the same typo. This is
//      the explicit "→ 400" example called out in the task.
//
// The route-level check uses a mock handler that mirrors the real route's
// auth + safeParse prologue but does not touch the database, so the test
// runs in pure-unit mode (no DATABASE_URL required).
// ---------------------------------------------------------------------------

describe("UpdateVendorPartnerBillingSettingsBody (api-zod schema)", () => {
  it("accepts every canonical (line_type → income_category) pair", () => {
    const overrides: Record<string, string> = {};
    for (const [i, lt] of INVOICE_LINE_TYPES.entries()) {
      // Cycle through income categories so we exercise every value too.
      overrides[lt] =
        INVOICE_LINE_INCOME_CATEGORIES[i % INVOICE_LINE_INCOME_CATEGORIES.length]!;
    }
    const result = UpdateVendorPartnerBillingSettingsBody.safeParse({
      vendorId: 1,
      partnerId: 2,
      defaultIncomeCategoryOverrides: overrides,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the empty {} override map (clear all overrides)", () => {
    const result = UpdateVendorPartnerBillingSettingsBody.safeParse({
      vendorId: 1,
      partnerId: 2,
      defaultIncomeCategoryOverrides: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts explicit null (clear the column entirely)", () => {
    const result = UpdateVendorPartnerBillingSettingsBody.safeParse({
      vendorId: 1,
      partnerId: 2,
      defaultIncomeCategoryOverrides: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid 1099 category value (typo)", () => {
    const result = UpdateVendorPartnerBillingSettingsBody.safeParse({
      vendorId: 1,
      partnerId: 2,
      defaultIncomeCategoryOverrides: { equipment: "not_a_real_box" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
      }));
      // The bad value is on the `equipment` key inside the override map.
      expect(
        flat.some(
          (f) =>
            Array.isArray(f.path) &&
            f.path[0] === "defaultIncomeCategoryOverrides" &&
            f.path[1] === "equipment",
        ),
      ).toBe(true);
    }
  });

  it("rejects a near-miss typo of a real category (misc_royaltys)", () => {
    const result = IncomeCategoryOverridesSchema.safeParse({
      other: "misc_royaltys", // missing 'ie' -> not in INVOICE_LINE_INCOME_CATEGORIES
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid line_type key", () => {
    const result = IncomeCategoryOverridesSchema.safeParse({
      bogus_line_type: "nec",
    });
    expect(result.success).toBe(false);
  });
});

describe("PUT /invoices/vendor-partner-billing-settings — body validation", () => {
  // Build an express app whose handler mirrors the prologue of the real route:
  // session auth, then safeParse via the shared schema. No DB calls, so this
  // works in any environment without a live Postgres.
  function buildApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.put("/invoices/vendor-partner-billing-settings", (req, res) => {
      // Simulate the auth gate. The real route uses `getSessionFromRequest`;
      // this unit test only exercises the body-parse failure path which runs
      // *after* that check, so a presence-only check on the session cookie
      // is enough to gate the request.
      const cookieHeader = req.headers.cookie ?? "";
      if (!cookieHeader.includes("vndrly_session=")) {
        res.status(401).json({
          error: "Not authenticated",
          code: "auth.not_authenticated",
        });
        return;
      }
      const body = UpdateVendorPartnerBillingSettingsBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({
          error: body.error.message,
          code: "validation.invalid_input",
        });
        return;
      }
      res.json({ ok: true });
    });
    attachTestErrorMiddleware(app, { logErrors: false });
    return app;
  }

  it("returns 400 for { equipment: 'not_a_real_box' }", async () => {
    const app = buildApp();
    const cookie = buildTestCookie({
      userId: 1,
      role: "admin",
      displayName: "Admin",
    });
    const res = await request(app)
      .put("/invoices/vendor-partner-billing-settings")
      .set("Cookie", cookie)
      .send({
        vendorId: 1,
        partnerId: 2,
        defaultIncomeCategoryOverrides: { equipment: "not_a_real_box" },
      });
    expectStatus(res, 400);
    expect(res.body).toMatchObject({ code: "validation.invalid_input" });
  });

  it("returns 200 for a valid override map", async () => {
    const app = buildApp();
    const cookie = buildTestCookie({
      userId: 1,
      role: "admin",
      displayName: "Admin",
    });
    const res = await request(app)
      .put("/invoices/vendor-partner-billing-settings")
      .set("Cookie", cookie)
      .send({
        vendorId: 1,
        partnerId: 2,
        defaultIncomeCategoryOverrides: { equipment: "misc_rents" },
      });
    expectStatus(res, 200);
  });
});
