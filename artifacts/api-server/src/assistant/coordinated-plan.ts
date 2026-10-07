import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
export type PlanIdentity = { userId: number; organizationKey: string };
export const planCompletionIntentSchema = z.discriminatedUnion("kind", [
 z.object({ kind: z.literal("planned_read_observed") }).strict(),
 z.object({ kind: z.literal("canonical_ticket_action_saved"), action: z.enum(["submit", "approve", "cancel"]), ticketId: z.number().int().positive() }).strict(),
 z.object({ kind: z.literal("canonical_work_hub_task_action_saved"), action: z.enum(["create", "complete", "cancel"]), title: z.string().trim().min(1).max(200).optional(), assigneeUserId: z.number().int().positive().nullable().optional(), taskId: z.string().uuid().optional() }).strict().refine(value => value.action === "create" ? value.title !== undefined && value.taskId === undefined : value.taskId !== undefined && value.title === undefined && value.assigneeUserId === undefined, "Supply exact task creation fields or existing task identity"),
]);
export type PlanStepInput = { id: string; specialist: string; toolNames: string[]; dependsOn: string[]; deadlineAt?: string; completion?: z.infer<typeof planCompletionIntentSchema> };
export type PlanStep = PlanStepInput & { state: "pending" | "completed" | "failed" | "waiting" | "cancelled"; resultReferences: string[]; detail?: string };
export type CoordinatedPlan = { schemaVersion: 1; id: string; version: number; identity: PlanIdentity; steps: PlanStep[] };
function validateGraph(steps: PlanStepInput[]) {
 if (!steps.length || steps.length > 100) throw Error("Plan needs 1 to 100 steps");
 const ids = new Set(steps.map(s=>s.id));
 if (ids.size !== steps.length || steps.some(s=>!s.id.trim() || !s.specialist.trim() || !s.toolNames.length || s.toolNames.some(n=>!n.trim()))) throw Error("Invalid plan step");
 for (const step of steps) if (step.deadlineAt !== undefined) z.string().datetime().parse(step.deadlineAt);
 for (const step of steps) if (step.completion !== undefined) planCompletionIntentSchema.parse(step.completion);
 const completed = new Set<string>(); const active = new Set<string>();
 const byId = new Map(steps.map(s=>[s.id,s]));
 function visit(id: string) {
  if(completed.has(id))return;
  if(active.has(id))throw Error("Plan dependency cycle");
  const step=byId.get(id);if(!step)throw Error("Unknown prerequisite");
  active.add(id);step.dependsOn.forEach(visit);active.delete(id);completed.add(id);
 }
 steps.forEach(s=>visit(s.id));
}
function assertIdentity(plan: CoordinatedPlan, identity: PlanIdentity) {
 if(plan.identity.userId!==identity.userId || plan.identity.organizationKey!==identity.organizationKey)throw Error("Plan identity changed");
}
/** Identity and tool availability must come from the authenticated server context, never model input. */
export function createCoordinatedPlan(identity: PlanIdentity, steps: PlanStepInput[]): CoordinatedPlan {
 if(!Number.isSafeInteger(identity.userId)||identity.userId<=0||!identity.organizationKey.trim())throw Error("Invalid plan identity");
 validateGraph(steps);
 return {schemaVersion:1,id:randomUUID(),version:1,identity:{...identity},steps:steps.map(s=>({...s,toolNames:[...s.toolNames],dependsOn:[...s.dependsOn],state:"pending",resultReferences:[]}))};
}
/** Recheck current permission-scoped tool names on every resume; this function never executes tools. */
export function eligiblePlanSteps(plan: CoordinatedPlan, identity: PlanIdentity, availableTools: ReadonlySet<string>): PlanStep[] {
 assertIdentity(plan,identity);validateGraph(plan.steps);
 return plan.steps.filter(s=>s.state==="pending" && s.toolNames.every(n=>availableTools.has(n)) && s.dependsOn.every(id=>plan.steps.find(p=>p.id===id)?.state==="completed"));
}
/** Deadline reporting is observational; it does not authorize or execute overdue work. */
export function overduePlanStepIds(plan: CoordinatedPlan, identity: PlanIdentity, now: number): string[] {
 assertIdentity(plan, identity); validateGraph(plan.steps);
 if (!Number.isFinite(now)) throw Error("Invalid plan observation time");
 return plan.steps.filter(step => step.state !== "completed" && step.state !== "cancelled" && step.deadlineAt !== undefined && Date.parse(step.deadlineAt) < now).map(step => step.id);
}
/** Call only after trusted record/action readback. References supplied by a model are not completion evidence.
 * Persist the returned plan with the Work Hub task's own expectedVersion and operationId.
 */
export function checkpointPlan(plan: CoordinatedPlan, identity: PlanIdentity, expectedVersion: number, stepId: string, result: Pick<PlanStep,"state"|"resultReferences"|"detail">): CoordinatedPlan {
 assertIdentity(plan,identity);validateGraph(plan.steps);
 if(plan.version!==expectedVersion)throw Error("Plan version changed");
 const step=plan.steps.find(s=>s.id===stepId);if(!step)throw Error("Unknown plan step");
 if(step.state==="completed"||step.state==="cancelled")throw Error("Plan step is terminal");
 if(result.state==="completed") {
  if(!result.resultReferences.length||result.resultReferences.some(r=>!r.trim()))throw Error("Completion needs trusted evidence");
  if(step.dependsOn.some(id=>plan.steps.find(s=>s.id===id)?.state!=="completed"))throw Error("Unfinished prerequisite");
 }
 return {...plan,version:plan.version+1,identity:{...plan.identity},steps:plan.steps.map(s=>({...s,toolNames:[...s.toolNames],dependsOn:[...s.dependsOn],resultReferences:s.id===stepId?[...result.resultReferences]:[...s.resultReferences],...(s.id===stepId?{state:result.state,detail:result.detail}:{})}))};
}

const persistedStep = z.object({
 id:z.string().trim().min(1).max(100),specialist:z.string().trim().min(1).max(100),
 toolNames:z.array(z.string().trim().min(1).max(150)).min(1).max(50),
 dependsOn:z.array(z.string().trim().min(1).max(100)).max(100),
 deadlineAt:z.string().datetime().optional(),
 completion:planCompletionIntentSchema.optional(),
 state:z.enum(["pending","completed","failed","waiting","cancelled"]),
 resultReferences:z.array(z.string().trim().min(1).max(500)).max(100),detail:z.string().max(2000).optional(),
}).strict();
const persistedPlan = z.object({schemaVersion:z.literal(1),id:z.string().uuid(),version:z.number().int().positive(),identity:z.object({userId:z.number().int().positive(),organizationKey:z.string().trim().min(1).max(500)}).strict(),steps:z.array(persistedStep).min(1).max(100)}).strict();
/** Stored descriptions are untrusted input; validate before using any checkpoint or dependency. */
export function decodePlanDescription(description:string,identity:PlanIdentity):CoordinatedPlan {
 if(description.length>20000)throw Error("Plan description too large");
 const plan=persistedPlan.parse(JSON.parse(description));assertIdentity(plan,identity);validateGraph(plan.steps);
 for(const step of plan.steps)if(step.state==="completed" && (!step.resultReferences.length || step.dependsOn.some(id=>plan.steps.find(s=>s.id===id)?.state!=="completed")))throw Error("Invalid completed checkpoint");
 return plan;
}
export function encodePlanDescription(plan:CoordinatedPlan):string {
 const description=JSON.stringify(plan);decodePlanDescription(description,plan.identity);return description;
}
