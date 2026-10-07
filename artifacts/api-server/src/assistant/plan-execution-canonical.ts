import { and, eq } from "drizzle-orm";
import { db, notificationPreferencesTable, notificationsTable, workHubClientOperationsTable } from "@workspace/db";
import { z } from "zod/v4";
import { AssetConditionSchema } from "@workspace/api-zod";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";
import { planExecutionResultSchema, type PlanExecutionAuthorization } from "./plan-execution";
import type { PersonalDraftCommand, PlanExecutionCanonicalApi } from "./plan-execution-adapters";
import { createPlanExecutionBusinessReads, PLAN_EXECUTION_BUSINESS_READ_CANDIDATES } from "./plan-execution-business-reads";

type Authority = Awaited<ReturnType<typeof currentPlanExecutionAuthority>>;
type Receipt = Pick<typeof workHubClientOperationsTable.$inferSelect, "userId" | "commandKind" | "operationId" | "ownerOrgType" | "ownerOrgId" | "resultJson" | "appliedAt">;
type Dependencies = {
  authorize: typeof currentPlanExecutionAuthority;
  request: typeof callNaturalVoiceDomainApi;
  receipt: (userId: number, operationId: string) => Promise<Receipt | null>;
};
const receiptLookup: Dependencies["receipt"] = async (userId, operationId) => {
  const [row] = await db.select().from(workHubClientOperationsTable).where(and(eq(workHubClientOperationsTable.userId, userId), eq(workHubClientOperationsTable.commandKind, "task.create"), eq(workHubClientOperationsTable.operationId, operationId))).limit(1);
  return row ?? null;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ownerOf = (authorization: PlanExecutionAuthorization) => {
  const match = /^(vendor|partner):([1-9]\d*)$/.exec(authorization.requester.organizationKey);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw Error("Invalid approved organization");
  return { type: match[1] as "vendor" | "partner", id: Number(match[2]) };
};
const warning = "Company Work Hub task assigned to you. Authorized coworkers may see it; this is not a guaranteed confidential personal note.\n\n";
const commandSchema = z.object({ operationId: z.uuid(), title: z.string().trim().min(1).max(200), description: z.string().min(1).max(12000), assigneeUserId: z.number().int().positive() }).strict();
function exactCommand(authorization: PlanExecutionAuthorization, input: PersonalDraftCommand) {
  const command = commandSchema.parse(input);
  if (command.assigneeUserId !== authorization.requester.userId || !authorization.steps.some(step => step.adapter === "personal_draft" && step.operationId === command.operationId && step.arguments.title === command.title)) throw Error("Draft differs from approved self-only operation");
  return { ...command, description: warning + command.description };
}
function assertCreate(authority: Authority, authorization: PlanExecutionAuthorization) {
  if (!authority.session.userId || !authority.current.availableTools.includes("manage_work_hub_task") || authority.session.vendorRole === "gate_supervisor") throw Error("Company task creation unavailable");
  const owner = ownerOf(authorization);
  requireWorkHubCapability(createWorkHubAccess({ session: { ...authority.session, userId: authority.session.userId }, owner, context: { kind: "organization", id: owner.id }, participant: true }), "task.assign");
}
const taskRow = z.object({ id: z.uuid(), title: z.string(), description: z.string().nullable(), ownerOrgType: z.enum(["vendor", "partner"]), ownerOrgId: z.number().int().positive(), assigneeUserId: z.number().int().positive().nullable(), version: z.number().int().positive(), status: z.string() });
/** Fixed canonical paths only. All received record text remains literal data. */
export function createPlanExecutionCanonicalApi(overrides: Partial<Dependencies> = {}): PlanExecutionCanonicalApi {
  const deps: Dependencies = { authorize: currentPlanExecutionAuthority, request: callNaturalVoiceDomainApi, receipt: receiptLookup, ...overrides };
  async function readbackDraft(authorization: PlanExecutionAuthorization, supplied: PersonalDraftCommand) {
    const command = exactCommand(authorization, supplied), owner = ownerOf(authorization);
    const authority = await deps.authorize(authorization);
    assertCreate(authority, authorization);
    const receipt = await deps.receipt(authorization.requester.userId, command.operationId);
    if (!receipt) { assertCreate(await deps.authorize(authorization), authorization); return { state: "not_found" as const }; }
    if (receipt.userId !== authorization.requester.userId || receipt.commandKind !== "task.create" || receipt.operationId !== command.operationId || receipt.ownerOrgType !== owner.type || receipt.ownerOrgId !== owner.id || !receipt.appliedAt || !receipt.resultJson) return { state: "unknown" as const };
    const saved = taskRow.safeParse(receipt.resultJson);
    if (!saved.success || saved.data.title !== command.title || saved.data.description !== command.description || saved.data.assigneeUserId !== command.assigneeUserId || saved.data.ownerOrgType !== owner.type || saved.data.ownerOrgId !== owner.id || saved.data.status !== "open" || receipt.resultJson.createdById !== command.assigneeUserId || receipt.resultJson.priority !== "normal" || receipt.resultJson.channelId != null || receipt.resultJson.dueAt != null || receipt.resultJson.recurrence != null) return { state: "unknown" as const };
    const fresh = await deps.authorize(authorization);
    assertCreate(fresh, authorization);
    const current = taskRow.safeParse(await deps.request(`/work-hub/search/items/task/${saved.data.id}`, "GET", {}, fresh.session));
    assertCreate(await deps.authorize(authorization), authorization);
    if (!current.success || Object.entries(saved.data).some(([key, value]) => current.data[key as keyof typeof current.data] !== value)) return { state: "unknown" as const };
    return { state: "completed" as const, result: planExecutionResultSchema.parse({ operationId: command.operationId, sourceReferences: [`task:${saved.data.id}:v${saved.data.version}`], summary: "Company Work Hub draft task saved and read back, assigned only to the requester. Authorized coworkers may see it; no business action was completed." }) };
  }
  return {
    readbackDraft,
    async savePersonalDraft(authorization, supplied) {
      const prior = await readbackDraft(authorization, supplied);
      if (prior.state === "completed") return prior.result;
      if (prior.state !== "not_found") throw Error("Canonical draft outcome remains unknown");
      const command = exactCommand(authorization, supplied), owner = ownerOf(authorization), authority = await deps.authorize(authorization);
      assertCreate(authority, authorization);
      const response = record(await deps.request("/work-hub/tasks", "POST", { operationId: command.operationId, owner, context: { kind: "organization", id: owner.id }, expectedVersion: null, payloadVersion: 1, payload: { title: command.title, description: command.description, assigneeUserId: command.assigneeUserId, priority: "normal" } }, authority.session));
      if (response.ok === false || response.error || response.operationId !== command.operationId) throw Error("Canonical draft save is unverified");
      const result = await readbackDraft(authorization, supplied);
      if (result.state !== "completed") throw Error("Canonical draft readback is unverified");
      return result.result;
    },
    async read(authorization, step) {
      // Existing custody delegations retain their original bound adapter. New
      // business families dispatch only through fixed canonical read tools.
      if (Object.hasOwn(PLAN_EXECUTION_BUSINESS_READ_CANDIDATES, step.toolName) && (step.toolName !== "query_asset_custody" || typeof step.arguments.checkedOutLongerThanDays === "number" && step.arguments.checkedOutLongerThanDays >= 90)) return createPlanExecutionBusinessReads({ authorize: deps.authorize })(authorization, step);
      if (step.adapter !== "authorized_read" || !authorization.steps.some(saved => saved.id === step.id && saved.operationId === step.operationId && saved.toolName === step.toolName && JSON.stringify(saved.arguments) === JSON.stringify(step.arguments))) throw Error("Read differs from approved operation");
      const authority = await deps.authorize(authorization);
      if (!authority.current.availableTools.includes(step.toolName)) throw Error("Read permission unavailable");
      let path: string;
      if (step.toolName === "list_work_hub_tasks") {
        const args = z.object({ status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(), assigneeUserId: z.number().int().positive().optional() }).strict().parse(step.arguments);
        if (args.assigneeUserId && args.assigneeUserId !== authorization.requester.userId) throw Error("Unattended task assignee filter must be self");
        path = `/work-hub/tasks${args.status ? `?status=${args.status}` : ""}`;
      } else if (step.toolName === "query_asset_custody") {
        const args = z.object({ assetId: z.uuid().optional(), checkedOutLongerThanDays: z.number().int().min(1).max(36500).optional() }).strict().parse(step.arguments);
        if (args.assetId && args.checkedOutLongerThanDays !== undefined) throw Error("Choose exact asset or custody-age query");
        path = args.assetId ? `/implementation-a/assets/${args.assetId}` : `/implementation-a/assets${args.checkedOutLongerThanDays !== undefined ? `?checkedOutLongerThanDays=${args.checkedOutLongerThanDays}` : ""}`;
      } else throw Error("Unsupported unattended read");
      const output = await deps.request(path, "GET", {}, authority.session);
      await deps.authorize(authorization);
      if (record(output).ok === false || record(output).error) throw Error("Canonical read failed");
      const owner = ownerOf(authorization);
      if (step.toolName === "query_asset_custody" && step.arguments.assetId) {
        const responsible = record(record(output).responsibleOwner);
        if (responsible.type !== owner.type || responsible.id !== owner.id || record(output).id !== step.arguments.assetId) throw Error("Exact asset belongs to another approved context");
      }
      const rows = step.toolName === "list_work_hub_tasks" ? z.array(taskRow).parse(output).filter(row => row.ownerOrgType === owner.type && row.ownerOrgId === owner.id && (!step.arguments.assigneeUserId || row.assigneeUserId === step.arguments.assigneeUserId)) : path.includes(`/assets/`) ? [record(output)] : z.array(z.record(z.string(), z.unknown())).parse(record(output).assets);
      const bounded = rows.slice(0, 25);
      const summaries = bounded.map(row => step.toolName === "list_work_hub_tasks" ? { id: z.uuid().parse(row.id), title: z.string().max(200).parse(row.title), status: z.string().max(50).parse(row.status) } : { id: z.uuid().parse(row.id), name: z.string().max(200).parse(record(row).name), status: z.string().max(50).parse(row.status), condition: AssetConditionSchema.nullable().parse(record(row).condition ?? null) });
      const summary = JSON.stringify({ query: step.toolName, records: summaries, partial: rows.length >= 25, limitation: "Recorded metadata only; at most 25 records shown, not physical verification or a complete operational report.", ...(record(output).unknownCustodyDates ? { unknownCustodyDatesCount: z.array(z.unknown()).parse(record(output).unknownCustodyDates).length } : {}) });
      return planExecutionResultSchema.parse({ operationId: step.operationId, sourceReferences: [`query:${step.toolName}`, ...summaries.map(row => `${step.toolName === "list_work_hub_tasks" ? "task" : "asset"}:${row.id}`)], summary });
    },
  };
}

type Inbox = { userId: number; type: string; title: string; body: string | null; link: string | null; dedupeKey: string | null };
type NotifyDependencies = { authorize: typeof currentPlanExecutionAuthority; enabled: (userId: number) => Promise<boolean>; find: (userId: number, dedupeKey: string) => Promise<Inbox | null>; insert: (row: Inbox) => Promise<void> };
/** Inbox persistence only. No provider call, delivery, audibility or read claim. */
export function createPlanExecutionSelfNotifier(overrides: Partial<NotifyDependencies> = {}) {
  const deps: NotifyDependencies = { authorize: currentPlanExecutionAuthority, enabled: async userId => { const [row] = await db.select({ enabled: notificationPreferencesTable.systemEnabled }).from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId)).limit(1); return row?.enabled ?? true; }, find: async (userId, key) => { const [row] = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.dedupeKey, key))).limit(1); return row ?? null; }, insert: async row => { await db.insert(notificationsTable).values({ ...row, category: "system" }).onConflictDoNothing({ target: [notificationsTable.userId, notificationsTable.dedupeKey] }); }, ...overrides };
  return async (authorization: PlanExecutionAuthorization, operationId: string, brief: string): Promise<{ saved: true; operationId: string }> => {
    if (operationId !== authorization.notificationOperationId || !z.uuid().safeParse(operationId).success || !brief || brief.length > 20000) throw Error("Invalid approved self brief");
    const row: Inbox = { userId: authorization.requester.userId, type: "plan_execution_brief", title: "Plan execution brief", body: brief, link: `/work-hub/tasks/${authorization.taskId}`, dedupeKey: `plan-execution:${operationId}` };
    const exact = (value: Inbox) => Object.entries(row).every(([key, expected]) => value[key as keyof Inbox] === expected);
    await deps.authorize(authorization);
    const prior = await deps.find(row.userId, row.dedupeKey!);
    if (prior && !exact(prior)) throw Error("Self brief operation reused");
    if (!prior) { if (!await deps.enabled(row.userId)) throw Error("Self inbox notification preference disabled"); await deps.authorize(authorization); await deps.insert(row); }
    await deps.authorize(authorization);
    const saved = await deps.find(row.userId, row.dedupeKey!);
    await deps.authorize(authorization);
    if (!saved || !exact(saved)) throw Error("Self brief persistence unverified");
    return { saved: true, operationId };
  };
}
