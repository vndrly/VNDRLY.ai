import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import assistantRealtimeRouter from "./assistantRealtime";

const mocks = vi.hoisted(() => ({
  userLanguage: null as string | null,
  createCall: vi.fn(async () => "answer-sdp"),
  createSecret: vi.fn(async () => ({ value: "ek_test", expires_at: 123 })),
  runTool: vi.fn(async () => JSON.stringify({ ok: true })),
  writeAudit: vi.fn(async () => undefined),
  readConfirmation: vi.fn(async (): Promise<string | null> => null),
  runMutation: vi.fn(
    async (_scope: unknown, operation: () => Promise<string>) => ({
      hit: false,
      value: await operation(),
    }),
  ),
  session: {
    userId: 10,
    role: "vendor",
    vendorId: 22,
    partnerId: null,
    vendorPeopleId: null,
    displayName: "Vendor User",
  } as {
    userId: number;
    role: string;
    vendorId: number | null;
    partnerId: number | null;
    vendorPeopleId: number | null;
    displayName: string;
  },
}));
vi.mock("../assistant/askv-voice-confirmation", () => ({
  readVoiceConfirmation: mocks.readConfirmation,
}));
beforeEach(() => {
  mocks.readConfirmation.mockReset();
  mocks.readConfirmation.mockResolvedValue(null);
});

vi.mock("../assistant/askv-idempotency", async () => ({
  ...(await vi.importActual("../assistant/askv-idempotency")),
  runPersistentAskVMutation: mocks.runMutation,
}));
let testSessionNumber = 0;
let testSessionId = "session-0";
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => mocks.session,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { id?: string }) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => table.id === "users.id" ? [{ preferredLanguage: mocks.userLanguage }] : []),
        })),
      })),
    })),
  },
  usersTable: { id: "users.id" },
  onboardingProgressTable: {
    partnerId: "onboarding.partnerId",
    vendorId: "onboarding.vendorId",
    vendorPeopleId: "onboarding.vendorPeopleId",
  },
}));

vi.mock("../assistant/realtime-session", async () => {
  const actual = await vi.importActual<
    typeof import("../assistant/realtime-session")
  >("../assistant/realtime-session");
  return {
    ...actual,
    createAskVRealtimeCall: mocks.createCall,
    createAskVRealtimeClientSecret: mocks.createSecret,
  };
});

vi.mock("./assistant", () => ({
  runTool: mocks.runTool,
}));

vi.mock("../assistant/action-audit", () => ({
  writeAskVActionAudit: mocks.writeAudit,
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

function app() {
  const app = express();
  app.use(express.json());
  app.use(assistantRealtimeRouter);
  return app;
}

describe("AskV Realtime routes", () => {
  beforeEach(() => {
    mocks.userLanguage = null;
    testSessionId = `route-test-${++testSessionNumber}`;
    mocks.runMutation.mockClear();
    mocks.session = {
      userId: 10,
      role: "vendor",
      vendorId: 22,
      partnerId: null,
      vendorPeopleId: null,
      displayName: "Vendor User",
    };
    mocks.createCall.mockClear();
    mocks.createSecret.mockClear();
    mocks.runTool.mockClear();
    mocks.runTool.mockResolvedValue(JSON.stringify({ ok: true }));
    mocks.writeAudit.mockClear();
  });

  it("returns a timezone-aware greeting without exposing raw audio", async () => {
    const res = await request(app())
      .get("/assistant/voice/greeting")
      .query({ timeZone: "America/Chicago" })
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        style: expect.stringMatching(/^(full|short)$/),
        text: expect.any(String),
        localDate: expect.any(String),
      }),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/audio|wav|webm|pcm/i);
  });

  it.each([[null, "en"], ["es", "es"], ["unexpected", "en"]])("uses saved language %s consistently for audio and transcription", async (saved, expected) => {
    mocks.userLanguage = saved;
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    await request(app()).post("/assistant/realtime/call").set("Content-Type", "application/sdp").send("offer-sdp").expect(200);
    await request(app()).post("/assistant/realtime/client-secret").send({}).expect(200);
    for (const create of [mocks.createCall, mocks.createSecret]) {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ language: expected }));
    }
  });

  it("creates a server-mediated Realtime WebRTC call from browser SDP", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ASKV_REALTIME_MODEL", "");

    const res = await request(app())
      .post("/assistant/realtime/call")
      .set("Content-Type", "application/sdp")
      .send("offer-sdp")
      .expect(200);

    expect(res.text).toBe("answer-sdp");
    expect(res.headers["content-type"]).toContain("application/sdp");
    expect(mocks.createCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test",
        userId: 10,
        model: "gpt-realtime-2.1",
        voice: "marin",
        sdp: "offer-sdp",
        tools: expect.arrayContaining([
          expect.objectContaining({
            type: "function",
            name: "query_tickets",
          }),
        ]),
      }),
    );
  });

  it("returns tool metadata with the ephemeral client secret", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ASKV_REALTIME_MODEL", "");

    const res = await request(app())
      .post("/assistant/realtime/client-secret")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        seedMessage: "route me to ticket 42",
      })
      .expect(200);

    expect(res.body.clientSecret).toEqual({
      value: "ek_test",
      expires_at: 123,
    });
    expect(res.body.toolMetadata).toContainEqual({
      name: "query_tickets",
      mutating: false,
      confirmation: "none",
      auditTarget: "ticket",
    });
    expect(res.body.toolMetadata).toContainEqual(
      expect.objectContaining({
        name: "query_attention_briefing",
        mutating: false,
        confirmation: "none",
      }),
    );
    expect(mocks.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-realtime-2.1",
      }),
    );
  });

  it("refuses tool calls outside the authenticated role even if posted manually", async () => {
    mocks.session = {
      userId: 11,
      role: "field_employee",
      vendorId: 22,
      partnerId: null,
      vendorPeopleId: 44,
      displayName: "Field User",
    };

    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "query_invoice_summary",
        arguments: {},
        clientSurface: "ios",
      })
      .expect(403);

    expect(res.body).toMatchObject({
      code: "assistant.tool_not_allowed",
    });
  });

  it("requires confirmation before realtime voice write tools execute", async () => {
    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "mark_notifications_read",
        arguments: { markAll: true },
        clientSurface: "web",
      })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: false,
      requiresConfirmation: true,
    });
    expect(mocks.runTool).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai_realtime",
        toolName: "mark_notifications_read",
        resultStatus: "requires_confirmation",
      }),
    );
  });

  it("passes confirmed:true into realtime voice write tools after confirmation", async () => {
    mocks.readConfirmation.mockResolvedValue("I confirm");
    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "mark_notifications_read",
        arguments: { markAll: true },
        clientSurface: "ios",
      })
      .expect(200);

    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "mark_notifications_read",
        arguments: { markAll: true },
        confirmationPhrase: "yes",
        clientSurface: "ios",
      })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true });
    expect(mocks.runTool).toHaveBeenCalledWith(
      "mark_notifications_read",
      expect.objectContaining({
        markAll: true,
        confirmed: true,
        idempotencyKey: expect.any(String),
      }),
      expect.objectContaining({ userId: 10, role: "vendor" }),
      expect.any(String),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMode: "ios_voice",
        toolName: "mark_notifications_read",
        confirmationPhrase: "I confirm",
        toolInput: expect.objectContaining({
          markAll: true,
          idempotencyKey: "call-1",
        }),
        resultStatus: "success",
      }),
    );
  });

  it("does not treat a generic yes as approval when nothing is pending", async () => {
    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "confirm_visitor_check_in",
        arguments: {
          firstName: "Bob",
          lastName: "Villa",
          siteLocationId: 9,
          hostType: "vendor",
        },
        confirmationPhrase: "yes",
        clientSurface: "web",
      })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: false,
      requiresConfirmation: true,
    });
    expect(mocks.runTool).not.toHaveBeenCalled();
  });

  it("audits structured confirmation refusals from realtime tools", async () => {
    mocks.readConfirmation.mockResolvedValue("yes");
    mocks.runTool.mockResolvedValueOnce(
      JSON.stringify({
        error:
          "AskV needs explicit confirmation before marking notifications read.",
        requiresConfirmation: true,
      }),
    );

    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "mark_notifications_read",
        arguments: { markAll: true },
        clientSurface: "web",
      })
      .expect(200);

    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: testSessionId,
        callId: "call-1",
        name: "mark_notifications_read",
        arguments: { markAll: true },
        confirmationPhrase: "yes",
        clientSurface: "web",
      })
      .expect(200);

    expect(res.body).toMatchObject({ ok: false });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "mark_notifications_read",
        resultStatus: "requires_confirmation",
      }),
    );
  });
});

describe("AskV Realtime onboarding", () => {
  beforeEach(() => {
    mocks.session = { userId: 10, role: "vendor", vendorId: 22, partnerId: null, vendorPeopleId: null, displayName: "Vendor User" };
    mocks.runTool.mockReset();
    mocks.runTool.mockResolvedValue(JSON.stringify({ ok: true }));
    mocks.runMutation.mockClear();
    mocks.writeAudit.mockClear();
    testSessionId = `onboarding-${++testSessionNumber}`;
  });

  it("can select onboarding while viewing Gate without adding deferred office writes", async () => {
    const res = await request(app()).post("/assistant/realtime/tool-call").send({
      sessionId: testSessionId, name: "select_tool_pack", path: "/gate",
      arguments: { workflow: "onboarding" },
    }).expect(200);
    expect(res.body.context.workflow).toBe("onboarding");
    expect(res.body.tools.map((tool: { name: string }) => tool.name)).toContain("complete_onboarding_step");
    expect(res.body.tools.map((tool: { name: string }) => tool.name)).not.toContain("schedule_ticket_crew");
  });

  it.each([
    ["set_onboarding_field", { path: "firstEmployee.firstName", value: "Morgan" }],
    ["complete_onboarding_step", { step: "first-employee", nextStep: "done", skipped: false }],
    ["finalize_onboarding", {}],
  ])("requires a real saved user reply before executing %s and protects an exact retry", async (name, args) => {
    const original = { sessionId: testSessionId, callId: "onboarding-call", name, arguments: args, path: "/gate", clientSurface: "web" };
    const pending = await request(app()).post("/assistant/realtime/tool-call").send({
      ...original, confirmed: true, confirmationPhrase: "yes",
    }).expect(200);
    expect(pending.body.requiresConfirmation).toBe(true);
    expect(mocks.runTool).not.toHaveBeenCalled();
    const forged = await request(app()).post("/assistant/realtime/tool-call").send({
      ...original, confirmationPhrase: "yes", arguments: { ...args, confirmed: true },
    }).expect(200);
    expect(forged.body.requiresConfirmation).toBe(true);
    expect(mocks.runTool).not.toHaveBeenCalled();

    mocks.readConfirmation.mockResolvedValue("I confirm");
    const completed = await request(app()).post("/assistant/realtime/tool-call").send({
      ...original, confirmationEventId: "saved-user-turn",
    }).expect(200);
    expect(completed.body).toMatchObject({ ok: true, mutation: { name, refresh: expect.arrayContaining(["onboarding"]) } });
    expect(mocks.runTool).toHaveBeenCalledWith(name, expect.objectContaining({ ...args, confirmed: true }), expect.objectContaining({ vendorId: 22 }), "");
    const firstScope = mocks.runMutation.mock.calls[0][0];
    await request(app()).post("/assistant/realtime/tool-call").send(original).expect(200);
    expect(mocks.runMutation.mock.calls[1][0]).toEqual(firstScope);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ toolName: name, targetType: "onboarding", resultStatus: "success" }));
  });

  it("reports unclear approval separately from permissions and accepts the next clear saved reply", async () => {
    const action = { sessionId: testSessionId, callId: "clear-reply", name: "complete_onboarding_step", arguments: { step: "first-employee", nextStep: "done", skipped: false } };
    await request(app()).post("/assistant/realtime/tool-call").send(action).expect(200);
    mocks.readConfirmation.mockResolvedValue("Can you still hear me?");
    const unclear = await request(app()).post("/assistant/realtime/tool-call").send({ ...action, confirmationEventId: "audio-check" }).expect(200);
    expect(unclear.body).toMatchObject({ requiresConfirmation: true, confirmationReason: "unclear_reply", suggestedReplies: ["I confirm", "Cancel"] });
    expect(mocks.runTool).not.toHaveBeenCalled();
    mocks.readConfirmation.mockResolvedValue("Yes, continue");
    const accepted = await request(app()).post("/assistant/realtime/tool-call").send({ ...action, confirmationEventId: "clear-approval" }).expect(200);
    expect(accepted.body.ok).toBe(true);
    expect(mocks.runTool).toHaveBeenCalledOnce();
  });

  it("rejects field-employee finalization before running a domain action", async () => {
    mocks.session = { ...mocks.session, role: "field_employee", vendorPeopleId: 7 };
    await request(app()).post("/assistant/realtime/tool-call").send({
      sessionId: testSessionId, callId: "finalize", name: "finalize_onboarding", arguments: {},
    }).expect(403);
    expect(mocks.runTool).not.toHaveBeenCalled();
  });
});

describe("AskV Realtime safety regressions", () => {
  beforeEach(() => {
    mocks.session = { userId: 10, role: "vendor", vendorId: 22, partnerId: null, vendorPeopleId: null, displayName: "Vendor User" };
  });
  it("returns authenticated context and allows a bounded workflow switch", async () => {
    const context = await request(app())
      .post("/assistant/realtime/context")
      .send({
        sessionId: "pack-context",
        path: "/ticket/42?untrusted=ignored",
        entityId: 42,
        role: "admin",
        organization: { vendorId: 99 },
      })
      .expect(200);
    expect(context.body.context).toMatchObject({
      path: "/ticket/42",
      entityId: 42,
      role: "vendor",
      organization: { vendorId: 22 },
      workflow: "tickets",
    });
    const selected = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        sessionId: "pack-context",
        name: "select_tool_pack",
        arguments: { workflow: "finance" },
      })
      .expect(200);
    expect(selected.body.context.workflow).toBe("finance");
    expect(
      selected.body.tools.some(
        (tool: { name: string }) => tool.name === "query_invoices",
      ),
    ).toBe(true);
    expect(
      selected.body.tools.some(
        (tool: { name: string }) => tool.name === "confirm_visitor_check_in",
      ),
    ).toBe(false);
    const moved = await request(app())
      .post("/assistant/realtime/context")
      .send({ sessionId: "pack-context", path: "/ticket/43" })
      .expect(200);
    expect(moved.body.context).toMatchObject({
      entityId: 43,
      workflow: "tickets",
    });
    const dashboard = await request(app())
      .post("/assistant/realtime/context")
      .send({ sessionId: "pack-context", path: "/dashboard" })
      .expect(200);
    expect(dashboard.body.context.entityId).toBeNull();
  });
  it("enforces server rollout flags even when a client posts Realtime requests directly", async () => {
    vi.stubEnv("ASKV_NATURAL_VOICE_ENABLED", "0");
    try {
      const capabilities = await request(app())
        .get("/assistant/voice/capabilities")
        .expect(200);
      expect(capabilities.body.enabled).toBe(false);
      await request(app())
        .post("/assistant/realtime/tool-call")
        .send({ sessionId: "flag", name: "query_tickets", arguments: {} })
        .expect(503);
      await request(app())
        .post("/assistant/realtime/client-secret")
        .send({})
        .expect(503);
      await request(app())
        .post("/assistant/realtime/end")
        .send({ sessionId: "flag" })
        .expect(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  const highRisk = {
    name: "confirm_visitor_check_out",
    arguments: { visitId: 44 },
    clientSurface: "web",
  };
  it("does not trust a posted confirmed boolean", async () => {
    mocks.runTool.mockClear();
    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        ...highRisk,
        sessionId: "boolean-bypass",
        callId: "call-a",
        confirmed: true,
        arguments: { visitId: 44, confirmed: true },
      });
    expect(res.body.requiresConfirmation).toBe(true);
    expect(mocks.runTool).not.toHaveBeenCalled();
  });
  it("requires a new confirmation after any arguments change", async () => {
    mocks.runTool.mockClear();
    const original = {
      ...highRisk,
      sessionId: "argument-binding",
      callId: "call-a",
    };
    await request(app()).post("/assistant/realtime/tool-call").send(original);
    const res = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        ...original,
        arguments: { visitId: 99 },
        confirmationPhrase: "yes",
      });
    expect(res.body.requiresConfirmation).toBe(true);
    expect(mocks.runTool).not.toHaveBeenCalled();
  });
  it("cannot confirm a different session or a different context", async () => {
    mocks.runTool.mockClear();
    const original = {
      ...highRisk,
      sessionId: "context-a",
      callId: "call-a",
      path: "/gate",
      entityId: 9,
    };
    await request(app()).post("/assistant/realtime/tool-call").send(original);
    const other = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({ ...original, sessionId: "context-b", confirmationPhrase: "yes" });
    expect(other.body.requiresConfirmation).toBe(true);
    await request(app())
      .post("/assistant/realtime/context")
      .send({ sessionId: "context-a", path: "/tickets/5", entityId: 5 });
    const moved = await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        ...original,
        path: "/tickets/5",
        entityId: 5,
        confirmationPhrase: "yes",
      });
    expect(moved.body.requiresConfirmation).toBe(true);
    expect(mocks.runTool).not.toHaveBeenCalled();
  });
  it("rejects ended sessions, missing mutation keys and deferred writes", async () => {
    await request(app())
      .post("/assistant/realtime/end")
      .send({ sessionId: "ended" });
    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({ ...highRisk, sessionId: "ended", callId: "call-a" })
      .expect(409);
    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({ ...highRisk, sessionId: "missing-key" })
      .expect(400);
    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({
        name: "schedule_ticket_crew",
        sessionId: "deferred",
        callId: "call-a",
        confirmed: true,
      })
      .expect(403);
  });
  it("lets a confirmed exact retry reach durable duplicate protection", async () => {
    mocks.readConfirmation.mockResolvedValue("yes");
    mocks.runTool.mockClear();
    mocks.runMutation.mockClear();
    const original = {
      ...highRisk,
      sessionId: "exact-retry",
      callId: "call-a",
    };
    await request(app()).post("/assistant/realtime/tool-call").send(original);
    await request(app())
      .post("/assistant/realtime/tool-call")
      .send({ ...original, confirmationPhrase: "yes" });
    const retry = await request(app())
      .post("/assistant/realtime/tool-call")
      .send(original);
    expect(retry.body.requiresConfirmation).toBeUndefined();
    expect(mocks.runMutation).toHaveBeenCalledTimes(2);
    expect(mocks.runMutation.mock.calls[0][0]).toEqual(
      mocks.runMutation.mock.calls[1][0],
    );
  });
  it("accepts only transcript text fields before touching persistence", async () => {
    await request(app())
      .post("/assistant/voice/transcript")
      .send({
        conversationId: 1,
        sessionId: "s",
        eventId: "e",
        role: "user",
        content: "hello",
        audio: "raw",
      })
      .expect(400);
  });
});
