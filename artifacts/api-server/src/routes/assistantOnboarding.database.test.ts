import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { eq } from "drizzle-orm";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
import type { SessionPayload } from "../lib/session";

// No provider requests, employee invitations, or email are needed here.
// Authentication, transcripts, onboarding progress and mutation reservations use
// the real implementation and a newly provisioned local test database.
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("AskV onboarding through real voice persistence", () => {
  let app: express.Express;
  let canonicalApp: express.Express;
  let database: typeof import("@workspace/db");
  let runTool: typeof import("./assistant").runTool;
  let session: SessionPayload;
  let cookie: string;
  let progressId: number;
  let conversationId: number;
  let sessionId: string;

  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    database = await import("@workspace/db");
    runTool = (await import("./assistant")).runTool;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use((await import("./assistantRealtime")).default);
    attachTestErrorMiddleware(app);
    canonicalApp = express();
    canonicalApp.use(cookieParser());
    canonicalApp.use(express.json());
    canonicalApp.use("/api", (await import("./onboarding")).default);
    attachTestErrorMiddleware(canonicalApp);
  });

  const post = (path: string, body: object, auth = cookie) => request(app).post(path).set("Cookie", auth).send(body);
  const progress = async () => (await database.db.select().from(database.onboardingProgressTable).where(eq(database.onboardingProgressTable.id, progressId)))[0];
  const domain = async (name: string, input: object, identity = session) => JSON.parse(await runTool(name, input, identity, cookie));
  // Substitute only the loopback transport. The canonical route still decodes
  // the delegated session, authorizes the org, validates, and writes real rows.
  const routeCanonicalRequests = () => vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const response = await request(canonicalApp).post(new URL(String(url)).pathname)
      .set("Cookie", new Headers(init?.headers).get("cookie") ?? "")
      .send(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { "Content-Type": "application/json" } });
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const [vendor] = await database.db.insert(database.vendorsTable).values({ name: `AskV onboarding ${tag}`, contactName: "Synthetic user", contactEmail: `${tag}@example.invalid` }).returning();
    const [user] = await database.db.insert(database.usersTable).values({ username: `askv-onboarding-${tag}`, passwordHash: "unused-synthetic-fixture", role: "vendor", displayName: "Synthetic user" }).returning();
    session = { userId: user.id, role: "vendor", vendorId: vendor.id, membershipRole: "admin" };
    cookie = buildTestCookie(session);
    const [row] = await database.db.insert(database.onboardingProgressTable).values({
      orgType: "vendor", vendorId: vendor.id, currentStep: "first-employee",
      payload: { firstEmployee: { firstName: "Morgan", lastName: "Fixture", email: `${tag}@example.invalid` } },
    }).returning();
    progressId = row.id;
    conversationId = (await post("/assistant/voice/conversation", {}).expect(200)).body.conversationId;
    sessionId = `onboarding-${tag}`;
    await post("/assistant/realtime/context", { sessionId, conversationId, path: "/gate" }).expect(200);
  });

  it("advances saved employee details only after a later real user reply and replays without a second write", async () => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const action = { sessionId, callId: "complete-step", name: "complete_onboarding_step", arguments: { step: "first-employee", nextStep: "done", skipped: false } };
    try {
      await post("/assistant/voice/transcript", { conversationId, sessionId, eventId: "old-yes", role: "user", content: "Yes." }).expect(200);
      now++;
      const pending = await post("/assistant/realtime/tool-call", { ...action, confirmed: true, confirmationPhrase: "yes" }).expect(200);
      expect(pending.body.requiresConfirmation).toBe(true);
      expect((await progress()).currentStep).toBe("first-employee");
      const stale = await post("/assistant/realtime/tool-call", { ...action, confirmationEventId: "old-yes" }).expect(200);
      expect(stale.body.requiresConfirmation).toBe(true);
      now++;
      await post("/assistant/voice/transcript", { conversationId, sessionId, eventId: "actual-yes", role: "user", content: "Yes." }).expect(200);
      const completed = await post("/assistant/realtime/tool-call", { ...action, confirmationEventId: "actual-yes" }).expect(200);
      expect(completed.body).toMatchObject({ ok: true, mutation: { refresh: ["onboarding"] } });
      const first = await progress();
      expect(first.currentStep).toBe("done");
      expect(first.completedSteps).toEqual(["first-employee"]);
      const replay = await post("/assistant/realtime/tool-call", action).expect(200);
      expect(replay.body.replayed).toBe(true);
      expect((await progress()).updatedAt).toEqual(first.updatedAt);

      // Discard the process-local reservation cache and prove the SQL result survives.
      const { organizationKeyFromSession } = await import("../assistant/askv-pending-confirmation");
      const { mutationIdempotencyKey } = await import("../assistant/askv-idempotency");
      vi.resetModules();
      const durable = await import("../assistant/askv-idempotency");
      const replayAfterRestart = await durable.runPersistentAskVMutation({ userId: session.userId!, organizationKey: organizationKeyFromSession(session), sessionId, key: "complete-step", fingerprint: mutationIdempotencyKey(session.userId!, action.name, action.arguments) }, async () => { throw new Error("Duplicate domain execution"); });
      expect(replayAfterRestart).toMatchObject({ hit: true });
      expect(JSON.parse(replayAfterRestart.value)).toMatchObject({ ok: true, currentStep: "done" });
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps field validation, required-step checks and organization admin permissions in the real executor", async () => {
    expect(await domain("set_onboarding_field", { path: "firstEmployee.firstName", value: "Other", vendorId: 999999 }, { ...session, membershipRole: "member" })).toMatchObject({ error: expect.stringMatching(/permission/) });
    expect(await domain("complete_onboarding_step", { step: "first-employee", nextStep: "done" }, { ...session, membershipRole: "member" })).toMatchObject({ error: expect.stringMatching(/permission/) });
    expect(await domain("finalize_onboarding", {}, { ...session, membershipRole: "member" })).toMatchObject({ error: expect.stringMatching(/org admins/) });
    expect(await domain("set_onboarding_field", { path: "partnerId", value: 999999 })).toMatchObject({ error: expect.stringMatching(/valid onboarding field/) });
    expect(await domain("complete_onboarding_step", { step: "first-employee", nextStep: "done", skipped: true })).toMatchObject({ error: expect.stringMatching(/required/) });
    expect(await domain("set_onboarding_field", { path: "firstEmployee.email", value: "" })).toMatchObject({ ok: true });
    expect(await domain("complete_onboarding_step", { step: "first-employee", nextStep: "done" })).toMatchObject({ error: expect.stringContaining("firstEmployee.email") });
    expect((await progress()).currentStep).toBe("first-employee");
  });

  it("cannot choose another organization through model arguments", async () => {
    const [otherVendor] = await database.db.insert(database.vendorsTable).values({ name: `Other ${randomUUID()}`, contactName: "Other", contactEmail: "other@example.invalid" }).returning();
    const [otherProgress] = await database.db.insert(database.onboardingProgressTable).values({ orgType: "vendor", vendorId: otherVendor.id, currentStep: "first-employee", payload: { firstEmployee: { firstName: "Unchanged" } } }).returning();
    expect(await domain("set_onboarding_field", { path: "firstEmployee.firstName", value: "Updated", vendorId: otherVendor.id, orgId: otherVendor.id })).toMatchObject({ ok: true });
    expect((await progress()).payload).toMatchObject({ firstEmployee: { firstName: "Updated" } });
    const [untouched] = await database.db.select().from(database.onboardingProgressTable).where(eq(database.onboardingProgressTable.id, otherProgress.id));
    expect(untouched.payload).toEqual({ firstEmployee: { firstName: "Unchanged" } });
  });

  it.each(["mobile", "web"])("completes %s onboarding through canonical authorization and persists a revisited skipped step", async (surface) => {
    const { PLATFORM_EULA_VERSION } = await import("../lib/platform-eula-acceptance");
    const { LEGAL_POLICY_VERSION } = await import("../lib/legal-consent");
    const { decodeSession } = await import("../lib/session");
    const tag = randomUUID();
    const [partner] = await database.db.insert(database.partnersTable).values({ name: `AskV partner ${tag}`, contactName: "Synthetic partner", contactEmail: `${tag}@example.invalid` }).returning();
    const [user] = await database.db.insert(database.usersTable).values({ username: `askv-partner-${tag}`, passwordHash: "unused-synthetic-fixture", role: "partner", displayName: "Synthetic partner" }).returning();
    const identity: SessionPayload = { userId: user.id, role: "partner", partnerId: partner.id, membershipRole: "admin", exp: Math.floor(Date.now() / 1000) + 3600 };
    // Mobile's Bearer middleware authenticates req.cookies, leaving the raw
    // Cookie header empty at the runTool boundary.
    const rawCookie = surface === "web" ? buildTestCookie(identity) : "";
    const execute = async (name: string, args = {}) => JSON.parse(await runTool(name, args, identity, rawCookie));
    const [saved] = await database.db.insert(database.onboardingProgressTable).values({
      orgType: "partner", partnerId: partner.id, currentStep: "done", skippedSteps: ["preferences"],
      payload: {
        platformEula: { accepted: true, version: PLATFORM_EULA_VERSION },
        legalConsent: { accepted: true, version: LEGAL_POLICY_VERSION },
        firstSite: { name: "Synthetic site", address: "123 Fixture Rd", siteCode: `TEST-${tag}`, siteRadiusMeters: 100 },
        taxBilling: { federalTaxId: "synthetic-federal", stateTaxId: "synthetic-state", physicalAddress: "123 Fixture Rd", billingAddress: "123 Fixture Rd" },
      },
    }).returning();
    const fetcher = routeCanonicalRequests();
    try {
      const result = await execute("finalize_onboarding");
      expect(result).toMatchObject({ ok: true, response: expect.any(String) });
      expect(JSON.parse(result.response)).toMatchObject({ completedAt: expect.any(String) });
      const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
      const delegated = decodeSession(headers.get("cookie")!.slice("vndrly_session=".length));
      expect(delegated).toMatchObject({ userId: user.id, role: "partner", partnerId: partner.id, membershipRole: "admin" });
      expect(delegated!.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
      const [initial] = await database.db.select().from(database.partnersTable).where(eq(database.partnersTable.id, partner.id));
      expect(initial).toMatchObject({ federalTaxId: "synthetic-federal", platformEulaAcceptedByUserId: user.id });

      await database.db.update(database.onboardingProgressTable).set({ currentStep: "preferences" }).where(eq(database.onboardingProgressTable.id, saved.id));
      expect(await execute("set_onboarding_field", { path: "preferences.hoursOfOperation", value: "7 AM to 5 PM" })).toMatchObject({ ok: true });
      expect(await execute("complete_onboarding_step", { step: "preferences", nextStep: "invite-team" })).toMatchObject({ ok: true });
      expect(await execute("complete_onboarding_step", { step: "invite-team", nextStep: "done" })).toMatchObject({ ok: true });
      const [revisited] = await database.db.select().from(database.onboardingProgressTable).where(eq(database.onboardingProgressTable.id, saved.id));
      expect(revisited).toMatchObject({ skippedSteps: [], currentStep: "done", completedAt: expect.any(Date) });
      expect(await execute("finalize_onboarding")).toMatchObject({ ok: true });
      const [updated] = await database.db.select().from(database.partnersTable).where(eq(database.partnersTable.id, partner.id));
      expect(updated.hoursOfOperation).toBe("7 AM to 5 PM");
      const sites = await database.db.select().from(database.siteLocationsTable).where(eq(database.siteLocationsTable.partnerId, partner.id));
      expect(sites).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("retains canonical validation details and rejects expired or cross-organization delegated sessions", async () => {
    const fetcher = routeCanonicalRequests();
    try {
      const invalid = JSON.parse(await runTool("finalize_onboarding", {}, session, ""));
      expect(invalid).toMatchObject({ ok: false, status: 400, code: "onboarding.required_fields_missing", error: "Required fields missing", missing: expect.arrayContaining(["platformEula", "taxIds.federalTaxId"]) });
      const delegatedCookie = new Headers(fetcher.mock.calls[0][1]?.headers).get("cookie")!;
      const [otherVendor] = await database.db.insert(database.vendorsTable).values({ name: `Denied ${randomUUID()}`, contactName: "Other", contactEmail: "denied@example.invalid" }).returning();
      const denied = await request(canonicalApp).post(`/api/onboarding/vendor/${otherVendor.id}/complete`).set("Cookie", delegatedCookie).send({}).expect(403);
      expect(denied.body.code).toBe("auth.forbidden");
      const expired = JSON.parse(await runTool("finalize_onboarding", {}, { ...session, exp: Math.floor(Date.now() / 1000) - 1 }, ""));
      expect(expired).toMatchObject({ ok: false, status: 401, code: "auth.not_authenticated" });
      expect((await progress()).completedAt).toBeNull();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("submits new saved edits after revisiting a previously completed wizard through the canonical endpoint", async () => {
    await database.db.update(database.onboardingProgressTable).set({ currentStep: "branding", completedAt: new Date(), skippedSteps: ["branding"] }).where(eq(database.onboardingProgressTable.id, progressId));
    expect(await domain("set_onboarding_field", { path: "branding.logoUrl", value: "/new-logo.png" })).toMatchObject({ ok: true });
    expect(await domain("complete_onboarding_step", { step: "branding", nextStep: "tax-ids" })).toMatchObject({ ok: true });
    expect((await progress()).skippedSteps).toEqual([]);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`http://127.0.0.1:${process.env.PORT ?? "8080"}/api/onboarding/vendor/${session.vendorId}/complete`);
      expect(init).toMatchObject({ method: "POST", body: "{}" });
      const { decodeSession } = await import("../lib/session");
      expect(decodeSession(new Headers(init?.headers).get("cookie")!.slice("vndrly_session=".length))).toMatchObject(session);
      // Represent the canonical endpoint's successful completion without creating
      // employees, tokens, or email. Its own validation is owned by that route.
      await database.db.update(database.onboardingProgressTable).set({ completedAt: new Date() }).where(eq(database.onboardingProgressTable.id, progressId));
      return new Response(JSON.stringify({ currentStep: "done" }), { status: 200 });
    });
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const action = { sessionId, callId: "finish-revisited-wizard", name: "finalize_onboarding", arguments: {} };
      const pending = await post("/assistant/realtime/tool-call", action).expect(200);
      expect(pending.body.requiresConfirmation).toBe(true);
      now++;
      await post("/assistant/voice/transcript", { conversationId, sessionId, eventId: "confirm-revisited-wizard", role: "user", content: "Yes." }).expect(200);
      const completed = await post("/assistant/realtime/tool-call", { ...action, confirmationEventId: "confirm-revisited-wizard" }).expect(200);
      expect(completed.body.ok).toBe(true);
      const replay = await post("/assistant/realtime/tool-call", action).expect(200);
      expect(replay.body).toMatchObject({ ok: true, replayed: true });
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      clock.mockRestore();
      fetcher.mockRestore();
    }
  });
});
