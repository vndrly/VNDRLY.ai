import { validateAssistantSession, withAssistantGrants } from "./chatgpt-grant-store";
import { chatGptActionTools, chatGptReadableTools } from "./chatgpt-tool-access";
import { readExactPlanTask } from "./coordinated-plan-exact-task";
import { decodePlanDescription } from "./coordinated-plan";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { planExecutionFingerprint, type PlanExecutionAuthorization, type PlanExecutionCurrentAuthorization } from "./plan-execution";
import type { SessionPayload } from "../lib/session";
import { invoiceActivityAvailable } from "./invoice-activity-chatgpt";

/** Fresh authority only. Stored OAuth credentials and delegation data are not authority. */
export async function currentPlanExecutionAuthority(authorization: PlanExecutionAuthorization): Promise<{
  session: SessionPayload;
  scopes: string[];
  current: PlanExecutionCurrentAuthorization;
}> {
  const now = Date.now();
  if (authorization.expiresAt <= now) throw new Error("Delegation expired");
  const { session, scopes } = await withAssistantGrants(authorization.requester.userId, async (grants, database) => {
    const grant = grants.find(value => value.consentHash === authorization.grantReference && !value.revoked);
    if (!grant || !grant.refreshExpiresAt || grant.refreshExpiresAt <= now) throw new Error("Delegation connection unavailable");
    return { session: await validateAssistantSession(grant.session, database), scopes: [...grant.scopes] };
  });
  const organizationKey = session.role === "partner" && session.partnerId
    ? `partner:${session.partnerId}` : session.vendorId ? `vendor:${session.vendorId}` : null;
  if (!organizationKey || !session.activeMembershipId || !session.sv ||
      session.userId !== authorization.requester.userId ||
      organizationKey !== authorization.requester.organizationKey ||
      session.activeMembershipId !== authorization.requester.membershipId ||
      session.sv !== authorization.requester.sessionVersion) throw new Error("Delegation membership changed");
  const identity = { userId: authorization.requester.userId, organizationKey };
  const readable = chatGptReadableTools(session, scopes);
  if (!readable.some(tool => tool.name === "list_work_hub_tasks")) throw new Error("Plan read unavailable");
  // No owner-row lock is held across a canonical HTTP boundary.
  const task = await readExactPlanTask(path => callNaturalVoiceDomainApi(path, "GET", {}, session), authorization.taskId, identity);
  if (task.status === "completed" || task.status === "cancelled") throw new Error("Saved plan is terminal");
  const plan = decodePlanDescription(task.description, identity);
  const current: PlanExecutionCurrentAuthorization = {
    ...authorization.requester,
    grantReference: authorization.grantReference,
    grantRevoked: false,
    taskId: task.id,
    taskVersion: task.version,
    planId: plan.id,
    planVersion: plan.version,
    planFingerprint: planExecutionFingerprint(plan),
    availableTools: [...new Set([...readable, ...chatGptActionTools(session, scopes)].map(tool => tool.name).concat(invoiceActivityAvailable(session, scopes) ? ["query_invoice_activity"] : []))],
  };
  // Canonical adapters call this helper directly as well as through the executor.
  // Do not rely on the executor's separate preflight for effect-time authority.
  if (current.taskVersion !== authorization.taskVersion || current.planId !== authorization.planId ||
      current.planVersion !== authorization.planVersion || current.planFingerprint !== authorization.planFingerprint ||
      authorization.steps.some(step => !current.availableTools.includes(step.toolName))) {
    throw new Error("Approved plan or tool authority changed");
  }
  return { session, scopes, current };
}
