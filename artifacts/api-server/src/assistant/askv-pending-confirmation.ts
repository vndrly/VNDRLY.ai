import { classifyConfirmation } from "./action-classifier";
import type { SessionPayload } from "../lib/session";
import { findAskVTool } from "./tool-registry";
import {
  stableArguments,
  mutationIdempotencyKey,
  runPersistentAskVMutation,
} from "./askv-idempotency";
export interface AskVPendingConfirmation {
  userId: number;
  organizationKey: string;
  sessionId: string;
  contextKey: string;
  toolName: string;
  arguments: unknown;
  idempotencyKey: string;
}
export function organizationKeyFromSession(session: {
  role?: string;
  partnerId?: number | null;
  vendorId?: number | null;
  activeMembershipId?: number | null;
  vendorPeopleId?: number | null;
}): string {
  return stableArguments([
    session.role ?? "none",
    session.partnerId ?? null,
    session.vendorId ?? null,
    session.activeMembershipId ?? null,
    session.vendorPeopleId ?? null,
  ]);
}
export class AskVPendingConfirmationStore {
  private readonly pending = new Map<
    string,
    { value: AskVPendingConfirmation; expiresAt: number }
  >();
  constructor(private readonly now = () => Date.now()) {}
  private key(
    userId: number,
    organizationKey: string,
    sessionId: string,
  ): string {
    return stableArguments([userId, organizationKey, sessionId]);
  }
  set(value: AskVPendingConfirmation): void {
    for (const [key, entry] of this.pending)
      if (entry.expiresAt <= this.now()) this.pending.delete(key);
    const prior = this.pending.get(
      this.key(value.userId, value.organizationKey, value.sessionId),
    );
    if (prior && stableArguments(prior.value) === stableArguments(value))
      return;
    this.pending.set(
      this.key(value.userId, value.organizationKey, value.sessionId),
      {
        value: JSON.parse(JSON.stringify(value)) as AskVPendingConfirmation,
        expiresAt: this.now() + 300_000,
      },
    );
  }
  createdAt(
    userId: number,
    organizationKey: string,
    sessionId: string,
  ): number | null {
    if (!this.peek(userId, organizationKey, sessionId)) return null;
    return (
      this.pending.get(this.key(userId, organizationKey, sessionId))!
        .expiresAt - 300_000
    );
  }
  peek(
    userId: number,
    organizationKey: string,
    sessionId: string,
  ): AskVPendingConfirmation | null {
    const key = this.key(userId, organizationKey, sessionId);
    const entry = this.pending.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.pending.delete(key);
      return null;
    }
    return JSON.parse(JSON.stringify(entry.value)) as AskVPendingConfirmation;
  }
  clear(userId: number, organizationKey: string, sessionId: string): void {
    this.pending.delete(this.key(userId, organizationKey, sessionId));
  }
  consume(
    phrase: string,
    identity: AskVPendingConfirmation,
  ): AskVPendingConfirmation | null {
    if (classifyConfirmation(phrase) !== "confirm") return null;
    const key = this.key(
      identity.userId,
      identity.organizationKey,
      identity.sessionId,
    );
    const entry = this.pending.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.pending.delete(key);
      return null;
    }
    if (stableArguments(entry.value) !== stableArguments(identity)) return null;
    this.pending.delete(key);
    return entry.value;
  }
}
export const askvPendingConfirmations = new AskVPendingConfirmationStore();

const typedTurnApprovals = new Map<
  string,
  { key: string; expiresAt: number }
>();
const typedOrganizations = new Map<string, string>();
export function synchronizeTypedAskVContext(
  session: SessionPayload,
  conversationId: number,
  contextKey: string,
  phrase: string,
): void {
  const organizationKey = organizationKeyFromSession(session);
  const sessionId = `typed:${conversationId}`;
  const ownerKey = `${session.userId}:${conversationId}`;
  const previousOrganization = typedOrganizations.get(ownerKey);
  if (previousOrganization && previousOrganization !== organizationKey)
    askvPendingConfirmations.clear(
      session.userId!,
      previousOrganization,
      sessionId,
    );
  typedOrganizations.set(ownerKey, organizationKey);
  const pending = askvPendingConfirmations.peek(
    session.userId!,
    organizationKey,
    sessionId,
  );
  if (
    pending &&
    (pending.contextKey !== contextKey ||
      classifyConfirmation(phrase) === "cancel")
  ) {
    askvPendingConfirmations.clear(session.userId!, organizationKey, sessionId);
  }
}
/** Typed requests use the same server-owned confirmation and replay rules as voice. */
export async function runBoundTypedAskVTool(args: {
  name: string;
  input: unknown;
  session: SessionPayload;
  conversationId: number;
  turnId: number;
  contextKey: string;
  phrase: string;
  execute: (input: unknown) => Promise<string>;
}): Promise<string> {
  const tool = findAskVTool(args.name);
  if (!tool?.mutating) return args.execute(args.input);
  if (!args.session.userId)
    return JSON.stringify({ ok: false, error: "Sign in first." });
  const {
    confirmed: _confirmed,
    idempotencyKey: _key,
    voiceSessionId: _session,
    ...input
  } = args.input && typeof args.input === "object" && !Array.isArray(args.input)
    ? (args.input as Record<string, unknown>)
    : {};
  const userId = args.session.userId;
  const organizationKey = organizationKeyFromSession(args.session);
  const sessionId = `typed:${args.conversationId}`;
  const fingerprint = mutationIdempotencyKey(userId, args.name, input);
  const turnKey = stableArguments([
    userId,
    organizationKey,
    sessionId,
    args.turnId,
    fingerprint,
  ]);
  for (const [key, value] of typedTurnApprovals)
    if (value.expiresAt <= Date.now()) typedTurnApprovals.delete(key);
  synchronizeTypedAskVContext(
    args.session,
    args.conversationId,
    args.contextKey,
    args.phrase,
  );
  if (classifyConfirmation(args.phrase) === "cancel")
    return JSON.stringify({ ok: false, cancelled: true });
  const pending = askvPendingConfirmations.peek(
    userId,
    organizationKey,
    sessionId,
  );
  const exactPending =
    pending?.toolName === args.name &&
    pending.contextKey === args.contextKey &&
    stableArguments(pending.arguments) === stableArguments(input);
  let key = exactPending
    ? pending.idempotencyKey
    : `typed:${args.turnId}:${fingerprint}`;
  let confirmed = false;
  if (tool.confirmation === "required") {
    const approved = typedTurnApprovals.get(turnKey);
    if (approved) {
      key = approved.key;
      confirmed = true;
    } else if (
      exactPending &&
      askvPendingConfirmations.consume(args.phrase, {
        ...pending,
        arguments: input,
      })
    )
      confirmed = true;
    if (!confirmed) {
      askvPendingConfirmations.set({
        userId,
        organizationKey,
        sessionId,
        contextKey: args.contextKey,
        toolName: args.name,
        arguments: input,
        idempotencyKey: key,
      });
      return JSON.stringify({
        ok: false,
        requiresConfirmation: true,
        message: "Summarize this exact action and ask the user to confirm.",
        name: args.name,
        arguments: input,
      });
    }
    typedTurnApprovals.set(turnKey, { key, expiresAt: Date.now() + 300_000 });
  }
  const result = await runPersistentAskVMutation(
    { userId, organizationKey, sessionId, key, fingerprint },
    () =>
      args.execute({
        ...input,
        idempotencyKey: key,
        voiceSessionId: sessionId,
        ...(confirmed ? { confirmed: true } : {}),
      }),
  );
  return result.value;
}
