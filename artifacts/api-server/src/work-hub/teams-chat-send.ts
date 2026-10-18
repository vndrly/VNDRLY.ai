import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, workHubClientOperationsTable as operations, workHubAuditLogTable as audits } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { sendTeamsMessage, TeamsProviderError } from "./teams-graph";

export function chatFingerprint(connectionId: string, chatId: string, text: string) {
  return createHash("sha256").update(JSON.stringify([connectionId, chatId, text])).digest("hex");
}
export function replayChatOperation(result: Record<string, unknown> | null, fingerprint: string) {
  if (!result || result.fingerprint !== fingerprint) throw new TeamsProviderError("operation_conflict", 409);
  return { messageId: typeof result.messageId === "string" ? result.messageId : null,
    status: result.state === "sent" ? "sent" : "uncertain", replayed: true };
}

/** Claim before network I/O. Microsoft chat sends have no idempotency key: an
 * interrupted delivery remains uncertain and must never be automatically resent. */
export async function deliverTeamsChat(session: SessionPayload & {userId: number}, connectionId: string,
  token: string, chatId: string, text: string, operationId: string) {
  const ownerOrgType = session.vendorId ? "vendor" : "partner";
  const ownerOrgId = session.vendorId || session.partnerId;
  if (!ownerOrgId) throw new TeamsProviderError("organization_required", 403);
  const fingerprint = chatFingerprint(connectionId, chatId, text);
  const [claimed] = await db.insert(operations).values({ userId: session.userId, commandKind: "teams.chat.send", operationId,
    ownerOrgType, ownerOrgId, resultJson: { fingerprint, state: "sending", connectionId } }).onConflictDoNothing().returning();
  if (!claimed) {
    const [prior] = await db.select().from(operations).where(and(eq(operations.userId, session.userId),
      eq(operations.commandKind, "teams.chat.send"), eq(operations.operationId, operationId))).limit(1);
    if (!prior || prior.ownerOrgType !== ownerOrgType || prior.ownerOrgId !== ownerOrgId) throw new TeamsProviderError("operation_conflict", 409);
    return replayChatOperation(prior.resultJson, fingerprint);
  }
  try {
    const message = await sendTeamsMessage(token, chatId, text);
    if (!message.id) throw new TeamsProviderError("provider_invalid_response");
    await db.update(operations).set({ resultJson: { fingerprint, state: "sent", connectionId, messageId: message.id }, appliedAt: new Date() }).where(eq(operations.id, claimed.id));
    await db.insert(audits).values({ actorUserId: session.userId, ownerOrgType, ownerOrgId,
      action: "teams.chat.sent", subjectType: "teams_message", subjectId: message.id, source: "web", operationId,
      metadata: { connectionId } });
    return { messageId: message.id, status: "sent", replayed: false };
  } catch {
    // Even an audit/readback failure after delivery must not permit a second send.
    await db.update(operations).set({ resultJson: { fingerprint, state: "uncertain", connectionId } })
      .where(and(eq(operations.id, claimed.id), isNull(operations.appliedAt)));
    const [saved] = await db.select().from(operations).where(eq(operations.id, claimed.id)).limit(1);
    return { ...replayChatOperation(saved?.resultJson ?? null, fingerprint), replayed: false };
  }
}
