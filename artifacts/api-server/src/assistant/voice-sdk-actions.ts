import type { SessionPayload } from "../lib/session";
import { findAskVTool, normalizeAskVRole, toRealtimeTools, toRealtimeToolMetadata } from "./tool-registry";
import { toolsForRealtime, isVoiceWorkflow } from "./tool-packs";
import { classifyConfirmation } from "./action-classifier";
import { classifyGateIntent, isGateMutationTool } from "./gate-intent";
import { organizationKeyFromSession } from "./askv-pending-confirmation";
import { stableArguments, mutationIdempotencyKey, runPersistentAskVMutation } from "./askv-idempotency";
import { writeAskVActionAudit } from "./action-audit";
import { classifyToolResult } from "./tool-result";
import { voiceMutationHint } from "./voice-mutation";
import { voiceSdkTools } from "./voice-sdk-session";

type Pending = { name: string; input: string; key: string; eventId: string | null; path: string; expires: number };
const pending = new Map<string, Pending>();
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, value]) => value != null).map(([key, value]) => [key, clean(value)]));
}
type Executor = (name: string, input: unknown, session: SessionPayload, cookie: string, tokenMode?: boolean, authorized?: boolean, conversationId?: number) => Promise<string>;

/** SDK adapter to existing company-scoped domain operations. No voice/history preflight. */
export async function executeVoiceSdkAction(options: {
  session: SessionPayload; body: Record<string, any>; cookie: string; runTool: Executor;
}): Promise<{ status: number; data: Record<string, any> }> {
  const { session, body, cookie, runTool } = options;
  const reply = (status: number, data: Record<string, any>) => ({ status, data });
  const name = typeof body.name === "string" ? body.name : "";
  const definition = findAskVTool(name);
  if (!definition) return reply(400, { ok: false, error: "Unknown AskV tool" });
  const role = normalizeAskVRole(session.role);
  if (!(definition.roles.includes(role) || definition.roles.includes("any")) ||
      (definition.companyAdminOnly && session.membershipRole !== "admin" && role !== "admin")) {
    return reply(403, { ok: false, error: "This action is not available to your role", code: "assistant.tool_not_allowed" });
  }
  if (!validId(body.sessionId) || !validId(body.callId)) return reply(400, { ok: false, error: "Invalid voice action identity" });
  let parsed: unknown;
  try { parsed = typeof body.arguments === "string" ? JSON.parse(body.arguments) : body.arguments ?? {}; }
  catch { return reply(400, { ok: false, error: "Invalid tool arguments" }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply(400, { ok: false, error: "Invalid tool arguments" });
  const {
    confirmed: _confirmed, confirmationPhrase: _phrase, confirmationEventId: _event,
    idempotencyKey: _key, voiceSessionId: _session, ...domain
  } = clean(parsed) as Record<string, unknown>;
  const input = domain;
  if (["resolve_gate_check_in", "prepare_visitor_check_in", "confirm_visitor_check_in", "prepare_visitor_check_out", "confirm_visitor_check_out"].includes(name) &&
      body.gateDraft && typeof body.gateDraft === "object") {
    // Preserve the operator's current form values when the model omits a field.
    const control = new Set(["confirmed", "confirmationPhrase", "confirmationEventId", "idempotencyKey", "voiceSessionId"]);
    for (const key of Object.keys(definition.inputSchema.properties ?? {})) {
      if (!control.has(key) && input[key] == null && body.gateDraft[key] != null) input[key] = body.gateDraft[key];
    }
  }
  if (name === "select_tool_pack") {
    if (!isVoiceWorkflow(input.workflow)) return reply(400, { ok: false, error: "Unknown workflow" });
    const selected = voiceSdkTools(toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, workflow: input.workflow }));
    return reply(200, { ok: true, tools: toRealtimeTools(selected), toolMetadata: toRealtimeToolMetadata(selected),
      output: JSON.stringify({ ok: true, workflow: input.workflow, message: "The permitted workflow tools are available." }) });
  }
  const organizationKey = organizationKeyFromSession(session);
  const identity = stableArguments([session.userId, organizationKey, body.sessionId]);
  const path = typeof body.path === "string" ? body.path.slice(0, 500) : "";
  const userEvent = validId(body.utterance?.eventId) ? body.utterance.eventId : null;
  const phrase = userEvent && typeof body.utterance?.text === "string" ? body.utterance.text.slice(0, 8000) : "";
  const argsKey = stableArguments(input);
  const now = Date.now();
  for (const [key, value] of pending) if (value.expires <= now) pending.delete(key);
  const prior = pending.get(identity);
  const same = prior?.name === name && prior.input === argsKey && prior.path === path;
  const decision = classifyConfirmation(phrase);
  if (decision === "cancel") {
    pending.delete(identity);
    return reply(200, { ok: false, cancelled: true, output: JSON.stringify({ ok: true, message: "Cancelled" }) });
  }
  let confirmed = Boolean(same && userEvent && userEvent !== prior.eventId && decision === "confirm");
  if (!confirmed && isGateMutationTool(name) && !["confirm_visitor_check_in", "confirm_visitor_check_out"].includes(name)) {
    confirmed = classifyGateIntent({ utterance: phrase, toolName: name, toolArguments: input, currentDraft: body.gateDraft }).authorization === "submit";
  }
  const key = same ? prior.key : validId(body.idempotencyKey) ? body.idempotencyKey : body.callId;
  if (definition.confirmation === "required" && !confirmed) {
    if (!same) pending.set(identity, { name, input: argsKey, key, eventId: userEvent, path, expires: now + 300_000 });
    return reply(200, { ok: false, requiresConfirmation: true, idempotencyKey: key,
      message: "Describe this exact action and ask for the user's approval before executing it." });
  }
  if (confirmed) pending.delete(identity);
  const executable = { ...input, ...(definition.mutating ? { idempotencyKey: key, voiceSessionId: body.sessionId } : {}), ...(confirmed ? { confirmed: true } : {}) };
  const operation = () => runTool(name, executable, session, cookie, false, confirmed,
    Number.isSafeInteger(body.conversationId) && body.conversationId > 0 ? body.conversationId : undefined);
  const result = definition.mutating ? await runPersistentAskVMutation({
    userId: session.userId!, organizationKey, sessionId: body.sessionId, key,
    fingerprint: mutationIdempotencyKey(session.userId!, name, input),
  }, operation) : { hit: false, value: await operation() };
  const status = classifyToolResult(result.value, definition.mutating);
  if (definition.mutating) void writeAskVActionAudit({
    session, clientSurface: "ios", inputMode: "ios_voice", provider: "openai_realtime", toolName: name,
    toolInput: input, toolOutput: result.value, transcriptText: phrase || null,
    confirmationPhrase: confirmed ? phrase : null, resultStatus: status,
  }).catch(() => undefined);
  return reply(200, { ok: status === "success", output: result.value, replayed: result.hit,
    mutation: voiceMutationHint(name, input, result.value, status === "success", result.hit) });
}
