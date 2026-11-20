import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeVoiceSdkAction } from "./voice-sdk-actions";
import type { SessionPayload } from "../lib/session";
import { classifyConfirmation } from "./action-classifier";
const semantics = vi.hoisted(() => vi.fn());
vi.mock("./conversational-confirmation", () => ({ conversationalConfirmation: semantics }));
const connected = vi.hoisted(() => ({ calendar: vi.fn(), recovery: vi.fn() }));
vi.mock("./cooperative-v-runtime", () => ({ readSelectedVCalendar: connected.calendar, readVTaskRecovery: connected.recovery }));
vi.mock("./askv-idempotency", async () => ({
  ...await vi.importActual("./askv-idempotency"),
  runPersistentAskVMutation: async (_scope: unknown, run: () => Promise<string>) => ({ hit: false, value: await run() }),
}));
vi.mock("./action-audit", () => ({ writeAskVActionAudit: vi.fn(() => new Promise(() => {})) }));
const session = { userId: 17, role: "vendor", vendorId: 22, membershipRole: "admin" } as SessionPayload;
const runTool = vi.fn(async (_name: string, _input: unknown) => JSON.stringify({ ok: true }));
beforeEach(() => { runTool.mockClear(); connected.calendar.mockReset(); connected.recovery.mockReset(); semantics.mockReset().mockImplementation(async text => classifyConfirmation(text)); });
const invoke = (body: Record<string, unknown>, identity = session) =>
  executeVoiceSdkAction({ session: identity, body, cookie: "", runTool });
describe("SDK protected data and actions", () => {
  it("executes conversational acceptance only for the unchanged pending check-in on a later turn", async () => {
    const body = { name: "confirm_visitor_check_in", sessionId: "natural-checkin", callId: "c1", arguments: { firstName: "Test", vehiclePlate: "TEST123" }, path: "/gate", utterance: { eventId: "u1", text: "check in this visitor" } };
    await invoke(body);
    expect(runTool).not.toHaveBeenCalled();
    semantics.mockResolvedValue("confirm");
    await invoke(body);
    expect(semantics).not.toHaveBeenCalled();
    const saved = await invoke({ ...body, callId: "c2", utterance: { eventId: "u2", text: "Go ahead and confirmed it." } });
    expect(saved.data.ok).toBe(true);
    expect(runTool).toHaveBeenCalledOnce();
    expect(runTool.mock.calls[0][1]).toMatchObject({ confirmed: true, vehiclePlate: "TEST123" });
  });
  it.each(["none", "cancel"])("does not submit a conversational %s decision", async decision => {
    const body = { name: "confirm_visitor_check_out", sessionId: "natural-" + decision, callId: "c1", arguments: { visitId: 123 }, utterance: { eventId: "u1", text: "check out" } };
    await invoke(body);
    semantics.mockResolvedValue(decision);
    const result = await invoke({ ...body, utterance: { eventId: "u2", text: "Did it save or should we stop?" } });
    expect(result.data.ok).toBe(false);
    expect(runTool).not.toHaveBeenCalled();
  });
  it("does not classify approval against changed details", async () => {
    const body = { name: "confirm_visitor_check_in", sessionId: "changed-natural", callId: "c1", arguments: { vehiclePlate: "TEST123" }, utterance: { eventId: "u1", text: "check in" } };
    await invoke(body);
    semantics.mockResolvedValue("confirm");
    await invoke({ ...body, arguments: { vehiclePlate: "OTHER123" }, utterance: { eventId: "u2", text: "Go ahead and confirm it" } });
    expect(semantics).not.toHaveBeenCalled();
    expect(runTool).not.toHaveBeenCalled();
  });
  it("reconnects the explicitly selected external calendar through its existing authorization", async () => {
    const selectedConnection = { connectionId: "11111111-1111-4111-8111-111111111111", scope: "personal", personalPermission: true, savePersonalContentToCompany: false };
    connected.calendar.mockResolvedValue({ events: [{ title: "Private appointment" }] });
    const arguments_ = { start: "2026-11-17T00:00:00Z", end: "2026-11-18T00:00:00Z" };
    const result = await invoke({ name: "read_selected_external_calendar", sessionId: "calendar", callId: "c1", selectedConnection, arguments: arguments_ });
    expect(result.data.ok).toBe(true); expect(connected.calendar).toHaveBeenCalledWith(session, selectedConnection, arguments_);
    expect(runTool).not.toHaveBeenCalled();
  });
  it("cannot let a model choose a connection that the user did not select", async () => {
    const result = await invoke({ name: "read_selected_external_calendar", sessionId: "unselected", callId: "c1", arguments: { connectionId: "invented" } });
    expect(result.data.ok).toBe(false); expect(connected.calendar).not.toHaveBeenCalled();
  });
  it("reconnects saved task recovery and prevents restarting an already completed step", async () => {
    connected.recovery.mockResolvedValue({ taskId: "11111111-1111-4111-8111-111111111111", taskStatus: "active", completed: [{ id: "done", toolNames: ["mark_notifications_read"] }], remaining: [{ id: "next", detail: "Review" }], needed: "Continue" });
    const body = { sessionId: "saved", callId: "c1", taskId: "11111111-1111-4111-8111-111111111111", arguments: {} };
    const read = await invoke({ ...body, name: "read_selected_saved_task" });
    expect(read.data.recovery.remaining).toEqual(["Review"]);
    const mutation = await invoke({ ...body, name: "mark_notifications_read", arguments: { markAll: true }, utterance: { eventId: "u2", text: "I confirm" } });
    expect(mutation.data.message).toContain("completed"); expect(runTool).not.toHaveBeenCalled();
  });
  it("does not save private personal connection results through a company mutation", async () => {
    const result = await invoke({ name: "mark_notifications_read", sessionId: "private", callId: "c1", arguments: { markAll: true },
      selectedConnection: { connectionId: "11111111-1111-4111-8111-111111111111", scope: "personal", personalPermission: true, savePersonalContentToCompany: false } });
    expect(result.data.message).toContain("personal"); expect(runTool).not.toHaveBeenCalled();
  });
  it("checks role permissions on the server", async () => {
    const result = await invoke({ name: "query_invoice_summary", sessionId: "role", callId: "c1", arguments: {} },
      { ...session, role: "field_employee" });
    expect(result.status).toBe(403); expect(runTool).not.toHaveBeenCalled();
  });
  it("does not require a conversation or saved transcript for a read", async () => {
    const result = await invoke({ name: "query_notifications", sessionId: "read", callId: "c1", arguments: {} });
    expect(result.status).toBe(200); expect(runTool).toHaveBeenCalledOnce();
  });
  it("takes approval from a later actual user turn, without waiting for transcript storage or audit", async () => {
    const body = { name: "mark_notifications_read", sessionId: "confirm", callId: "c1", arguments: { markAll: true },
      path: "/notifications", utterance: { eventId: "u1", text: "Mark all read" } };
    const first = await invoke(body);
    expect(first.data.requiresConfirmation).toBe(true); expect(runTool).not.toHaveBeenCalled();
    const forged = await invoke({ ...body, arguments: { ...body.arguments, confirmed: true, confirmationPhrase: "I confirm" } });
    expect(forged.data.requiresConfirmation).toBe(true); expect(runTool).not.toHaveBeenCalled();
    const approved = await invoke({ ...body, callId: "c2", idempotencyKey: "c1", utterance: { eventId: "u2", text: "I confirm" } });
    expect(approved.data.ok).toBe(true); expect(runTool).toHaveBeenCalledOnce();
    expect(runTool.mock.calls[0][1]).toMatchObject({ confirmed: true, markAll: true });
  });
  it("cannot reuse another organization's pending action", async () => {
    const body = { name: "mark_notifications_read", sessionId: "org", callId: "c1", arguments: { markAll: true },
      utterance: { eventId: "u1", text: "Mark all read" } };
    await invoke(body);
    const changed = await invoke({ ...body, utterance: { eventId: "u2", text: "I confirm" } }, { ...session, vendorId: 23 });
    expect(changed.data.requiresConfirmation).toBe(true); expect(runTool).not.toHaveBeenCalled();
  });
  it("selects another permitted workflow without reconnecting voice", async () => {
    const result = await invoke({ name: "select_tool_pack", sessionId: "pack", callId: "c1", arguments: { workflow: "gate" } });
    expect(result.data.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "prepare_visitor_check_in" })]));
    expect(runTool).not.toHaveBeenCalled();
  });
  it("carries existing Gate form values without accepting approval metadata from the form", async () => {
    await invoke({ name: "prepare_visitor_check_in", sessionId: "form", callId: "c1",
      arguments: { firstName: "Current spoken name" }, gateDraft: {
        firstName: "Prior name", lastName: "Elerick", confirmed: true, voiceSessionId: "forged",
      } });
    expect(runTool).toHaveBeenCalledOnce();
    expect(runTool.mock.calls[0][1]).toMatchObject({ firstName: "Current spoken name", lastName: "Elerick" });
    expect(runTool.mock.calls[0][1]).not.toHaveProperty("confirmed");
    expect(runTool.mock.calls[0][1]).not.toHaveProperty("voiceSessionId", "forged");
  });
});

const focusedDraft = { voiceMode: "check-in", firstName: "Alex", lastName: "Reed", company: "Test Fleet", vehiclePlate: "TEST123", plateState: "OK", siteLocationId: 9 };
it("saves the live focused form with one spoken submit and no staged confirmation", async () => {
 const result = await invoke({ name: "confirm_visitor_check_in", sessionId: "focus-direct", callId: "c1", path: "/gate", gateDraft: focusedDraft, arguments: {}, utterance: { eventId: "spoken-submit", text: "submit" } });
 expect(result.data.ok).toBe(true); expect(result.data.requiresConfirmation).toBeUndefined();
 expect(runTool).toHaveBeenCalledOnce(); expect(runTool.mock.calls[0][1]).toMatchObject({ firstName: "Alex", plateState: "OK", confirmed: true });
});
it.each(["don't submit", "did it submit?", "change the plate instead", "the photo is ready"])("does not treat %s as focused submit", async text => {
 await invoke({ name: "confirm_visitor_check_in", sessionId: "focus-negative-"+text.replace(/[^a-z]/g,""), callId: "c1", path: "/gate", gateDraft: focusedDraft, arguments: {}, utterance: { eventId: "u1", text } });
 expect(runTool).not.toHaveBeenCalled();
});
it("does not submit a different state than the live form", async () => {
 await invoke({ name: "confirm_visitor_check_in", sessionId: "focus-stale", callId: "c1", path: "/gate", gateDraft: focusedDraft, arguments: {plateState:"TX"}, utterance: { eventId: "u1", text:"submit" } });
 expect(runTool).not.toHaveBeenCalled();
});

it("allows optional empty company and notes on one spoken submit", async () => {
 const result=await invoke({name:"confirm_visitor_check_in",sessionId:"focus-optional",callId:"c1",path:"/gate",gateDraft:{...focusedDraft,company:"",purpose:"",notes:""},arguments:{},utterance:{eventId:"u1",text:"submit"}});
 expect(result.data.ok).toBe(true);expect(runTool).toHaveBeenCalledOnce();
});

it("preserves the live form's saved photo evidence on spoken submit", async () => {
 const gateCapture = { images: [{ objectPath: "/objects/uploads/11111111-1111-4111-8111-111111111111", originalPath: "/objects/uploads/22222222-2222-4222-8222-222222222222", kind: "plate", capturedAt: "2026-11-20T07:00:00.000Z" }], arrivalRunId: "33333333-3333-4333-8333-333333333333" };
 const result = await invoke({ name: "confirm_visitor_check_in", sessionId: "focus-evidence", callId: "c1", path: "/gate", gateDraft: { ...focusedDraft, gateCapture }, arguments: {}, utterance: { eventId: "u1", text: "submit" } });
 expect(result.data.ok).toBe(true);
 expect(runTool.mock.calls[0][1]).toMatchObject({ gateCapture, confirmed: true });
});
