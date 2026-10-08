import { pool } from "@workspace/db";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { SESSION_SECRET } from "../lib/session";
import { getNativeCompanyPolicy } from "../services/native-operations";
import { authorizeVConnection, type VConnectionMetadata, type VConnectionSelection, vExternalCalendarWindowSchema } from "./cooperative-v-connections";
import { type VProvider } from "./cooperative-v";
import { readExactPlanTask } from "./coordinated-plan-exact-task";
import { resumedWorkPlan } from "./chatgpt-coordinated-plan";
import { verifiedPlanCompletionIds } from "./plan-completion-proof";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { toolsForRealtime } from "./tool-packs";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";
import { vUsageAlert } from "./cooperative-v-usage";
import { organizationKeyFromSession } from "./askv-pending-confirmation";

/** Lock only while recording a context boundary, never while waiting on a model.
 * A role/company switch cannot send a previous company's conversation to an engine.
 */
export async function bindVConversationCompany(session: SessionPayload, conversationId: number) {
  const organizationKey = organizationKeyFromSession(session);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT id FROM assistant_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE", [conversationId, session.userId]);
    if (!owned.rows.length) throw Error("Conversation not available in current account");
    const scopes = await client.query<{ parsedIntent: { organizationKey?: string } }>(`SELECT parsed_intent AS "parsedIntent" FROM assistant_action_audit WHERE conversation_id=$1 AND action_type IN ('askv_voice_conversation_scope','askv_conversation_scope')`, [conversationId]);
    if (scopes.rows.some(scope => scope.parsedIntent?.organizationKey !== organizationKey)) throw Error("Conversation company context changed");
    if (!scopes.rows.length) await client.query(`INSERT INTO assistant_action_audit
      (user_id,actor_role,partner_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,conversation_id,parsed_intent,result_status)
      VALUES($1,$2,$3,$4,'api','web_text','anthropic','cooperative_v','askv_conversation_scope',$5,$6::jsonb,'success')`,
      [session.userId, session.role ?? null, session.partnerId ?? null, session.vendorId ?? null, conversationId, JSON.stringify({ organizationKey })]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function resolveVTurnPolicy(session: SessionPayload) {
  // Platform/onboarding chats have no company context; retain their existing AskV
  // engine, without assuming company authorization to share them with OpenAI.
  if (!session.vendorId && !session.partnerId) return { enabled: false, approvedAiProviders: ["anthropic"] as VProvider[], openaiAvailable: false };
  const policy = await getNativeCompanyPolicy(session);
  const approvedAiProviders = policy.enabled ? policy.approvedAiProviders : policy.approvedAiProviders.filter(provider => provider === "anthropic");
  return { enabled: policy.enabled, approvedAiProviders, openaiAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()) };
}

const metadataColumns = "id,owner_org_type AS \"ownerOrgType\",owner_org_id AS \"ownerOrgId\",provider,capabilities,status,revoked_at AS \"revokedAt\",created_by_id AS \"createdById\"";
/** Signed context identifies the membership, but its current role is live authority. */
async function currentVConnectorActor(session: SessionPayload): Promise<SessionPayload> {
  const orgType = session.vendorId ? "vendor" : "partner";
  const orgId = session.vendorId ?? session.partnerId;
  if (!session.userId || !orgId) throw Error("Company membership required");
  const result = await pool.query<{ role: string }>(`SELECT role FROM user_org_memberships
    WHERE user_id=$1 AND org_type=$2 AND (vendor_id=$3 OR partner_id=$3)
      AND ($4::integer IS NULL OR id=$4) LIMIT 1`, [session.userId, orgType, orgId, session.activeMembershipId ?? null]);
  if (!result.rows[0]) throw Error("Current company membership unavailable");
  return { ...session, membershipRole: result.rows[0].role };
}
export async function readSelectedVConnection(session: SessionPayload, selection: VConnectionSelection, capability = "calendar.read") {
  const policy = await resolveVTurnPolicy(session); // fresh live membership and company policy
  if (!policy.enabled) throw Error("Company cooperative V connections are disabled");
  const actor = await currentVConnectorActor(session);
  const result = await pool.query<VConnectionMetadata>(`SELECT ${metadataColumns} FROM work_hub_calendar_connections WHERE id=$1`, [selection.connectionId]);
  const connection = result.rows[0];
  if (!connection) throw Error("Selected V connection is missing. Link an authorized connection and resume the saved task.");
  return { connection, authorization: authorizeVConnection(actor, connection, selection, capability) };
}

export async function listVConnections(session: SessionPayload) {
  if (!(await resolveVTurnPolicy(session)).enabled) return [];
  const actor = await currentVConnectorActor(session);
  const result = await pool.query<VConnectionMetadata>(`SELECT ${metadataColumns} FROM work_hub_calendar_connections WHERE
    (owner_org_type='user' AND owner_org_id=$1 AND created_by_id=$1) OR
    (owner_org_type='vendor' AND owner_org_id=$2) OR (owner_org_type='partner' AND owner_org_id=$3)`, [session.userId, session.vendorId ?? null, session.partnerId ?? null]);
  return result.rows.flatMap(connection => {
    const scope = connection.ownerOrgType === "user" ? "personal" : "company";
    try {
      authorizeVConnection(actor, connection, { connectionId: connection.id, scope, personalPermission: scope === "personal", savePersonalContentToCompany: false }, "calendar.read");
      return [{ id: connection.id, provider: connection.provider, scope, capabilities: connection.capabilities, personalPermissionRequired: scope === "personal" }];
    } catch { return []; }
  });
}

/** Company administrators see aggregate usage, never another worker's transcript,
 * personal connection content or provider credentials. Alerts never gate execution.
 */
export async function readCompanyVUsage(session: SessionPayload, administratorOnly = true) {
  const policy = await getNativeCompanyPolicy(session);
  const actor = await currentVConnectorActor(session);
  if (!session.userId) throw Error("Authentication required");
  const owner = session.vendorId ? { type: "vendor" as const, id: session.vendorId } : session.partnerId ? { type: "partner" as const, id: session.partnerId } : null;
  if (!owner) throw Error("Company context required");
  if (administratorOnly) requireWorkHubCapability(createWorkHubAccess({ session: { ...actor, userId: session.userId }, owner, context: { kind: "organization", id: owner.id }, participant: false }), "policy.manage");
  const result = await pool.query<{ tokens: string; estimatedCostUsd: string; unpricedRounds: string }>(`
    SELECT COALESCE(SUM((tool_output->>'inputTokens')::numeric+(tool_output->>'outputTokens')::numeric),0)::text AS tokens,
      COALESCE(SUM((tool_output->>'estimatedCostUsd')::numeric),0)::text AS "estimatedCostUsd",
      COUNT(*) FILTER (WHERE tool_output->>'estimatedCostUsd' IS NULL)::text AS "unpricedRounds"
    FROM assistant_action_audit WHERE action_type='cooperative_v_usage' AND created_at>=date_trunc('month',now())
      AND (($1='vendor' AND vendor_id=$2) OR ($1='partner' AND partner_id=$2))`, [owner.type, owner.id]);
  const row = result.rows[0];
  return { period: "current_calendar_month", ...vUsageAlert({ tokens: Number(row?.tokens ?? 0), estimatedCostUsd: Number(row?.estimatedCostUsd ?? 0), unpricedRounds: Number(row?.unpricedRounds ?? 0) },
    { usageAlertTokens: policy.usageAlertTokens, usageAlertUsd: policy.usageAlertUsd }) };
}

/** Reads already-synchronized, selected calendar rows only. External credentials are
 * never decrypted here and never included in either provider's context package.
 */
export async function readSelectedVCalendar(session: SessionPayload, selection: VConnectionSelection, rawWindow: unknown) {
  const window = vExternalCalendarWindowSchema.parse(rawWindow);
  const selected = await readSelectedVConnection(session, selection);
  const result = await pool.query<{ id: string; title: string; startsAt: Date; endsAt: Date; location: string | null; syncedAt: Date }>(`
    SELECT e.id,e.title,e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.location,e.synced_at AS "syncedAt"
    FROM work_hub_external_events e JOIN work_hub_external_calendars c ON c.id=e.calendar_id
    WHERE c.connection_id=$1 AND c.selected='true' AND e.cancelled_at IS NULL AND e.starts_at<$3 AND e.ends_at>$2
    ORDER BY e.starts_at,e.id LIMIT 25`, [selected.connection.id, window.start, window.end]);
  return { ...selected.authorization, source: "authorized_synced_calendar", liveProviderRead: false, window, events: result.rows,
    detail: "Saved synchronization timestamps identify freshness. This read does not imply a live connection refresh." };
}

export async function readVTaskRecovery(session: SessionPayload, rawTaskId: unknown) {
  const taskId = z.uuid().parse(rawTaskId);
  if (!session.userId) throw Error("Authentication required");
  await resolveVTurnPolicy(session);
  const organizationKey = session.vendorId ? `vendor:${session.vendorId}` : session.partnerId ? `partner:${session.partnerId}` : null;
  if (!organizationKey) throw Error("Company task context required");
  const identity = { userId: session.userId, organizationKey };
  const task = await readExactPlanTask(path => callNaturalVoiceDomainApi(path, "GET", {}, session), taskId, identity);
  const available = new Set(toolsForRealtime({ role: session.role, membershipRole: session.membershipRole, path: "/work-hub/askv" }).map(tool => tool.name));
  const resumed = resumedWorkPlan([task], taskId, identity, available, Date.now(), (id, plan) => verifiedPlanCompletionIds(SESSION_SECRET, id, plan));
  return { taskId: resumed.taskId, taskVersion: resumed.taskVersion, taskStatus: resumed.taskStatus,
    completed: resumed.plan.steps.filter(step => step.state === "completed").map(step => ({ id: step.id, state: step.state, toolNames: step.toolNames, resultReferences: step.resultReferences, recorded: true, readbackRequired: true })),
    remaining: resumed.plan.steps.filter(step => step.state !== "completed" && step.state !== "cancelled").map(step => ({ id: step.id, state: step.state, toolNames: step.toolNames, dependsOn: step.dependsOn, detail: step.detail })),
    eligibleStepIds: resumed.eligibleStepIds, executionStarted: false,
    needed: "Use existing saved-plan controls and canonical result readback. Never restart completed steps. Missing connection or permission leaves the task intact.",
  };
}
