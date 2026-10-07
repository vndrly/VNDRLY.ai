import {z} from 'zod/v4';
import {CalendarPlannerPreferencesSchema,createCanonicalCalendarPlanner} from './plan-execution-calendar-planner';
import type {PlanExecutionRun,PlanExecutionAuthorization} from './plan-execution';
import type {SessionPayload} from '../lib/session';
const inputSchema=z.object({reference:z.uuid(),preferences:CalendarPlannerPreferencesSchema}).strict();
const required=['list_work_hub_tasks','get_work_hub_calendar','get_work_hub_calendar_item','get_work_hub_meeting_catchup','find_work_hub_meeting_times','manage_work_hub_meeting'];
const outputSchema=z.object({reference:z.uuid(),state:z.enum(['proposed','needs_info','priority_order_no_slot']),issues:z.array(z.string()),deadline:z.string().nullable(),executionStarted:z.literal(false),limitation:z.string(),proposals:z.array(z.object({toolName:z.enum(['manage_work_hub_meeting','send_work_hub_message']),arguments:z.record(z.string(),z.unknown())})),contacts:z.array(z.object({occurrenceId:z.uuid(),state:z.enum(['proposal','invitation_sent','accepted','unanswered','declined'])})),evidence:z.array(z.object({kind:z.enum(['meeting','shift']),id:z.uuid(),version:z.number().nullable(),fingerprint:z.string(),participantUserIds:z.array(z.number())})),observedAt:z.string(),limitations:z.array(z.string()),calendarChangesSaved:z.literal(false),messagesSent:z.literal(false),delegationExpanded:z.literal(false)}).strict();
export const PLAN_EXECUTION_CALENDAR_TOOL={name:'v_plan_background_calendar',description:'Read this account’s exact approved saved delegation and current Work Hub calendar to propose meeting reschedules through tomorrow’s explicit local close-of-business time. Requires explicit timezone, priorities, travel buffers, dependencies and immutable commitments. Uses saved occurrence IDs and participants only. Returns proposals and fresh observation fingerprints; never executes changes, sends messages, infers invitation acceptance or expands the delegation. External calendars and travel facts are not discovered; priority-first proposals do not prove global feasibility.',inputSchema:{...z.toJSONSchema(inputSchema),type:'object' as const},outputSchema:{...z.toJSONSchema(outputSchema),type:'object' as const},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}};
type Dependencies={enabled:()=>boolean;status:(reference:string,session:SessionPayload)=>Promise<PlanExecutionRun>;available:(session:SessionPayload,scopes:string[])=>string[]|Promise<string[]>;plan:(authorization:PlanExecutionAuthorization,preferences:unknown)=>Promise<Awaited<ReturnType<ReturnType<typeof createCanonicalCalendarPlanner>>>>};
/** Fixed read-only entry point. Shared discovery/dispatch wiring belongs to the route owner. */
export function createPlanExecutionCalendarHandler(overrides:Partial<Dependencies>={}){
 const deps:Dependencies={enabled:()=>process.env.ASSISTANT_PLAN_EXECUTION_ENABLED==='1',status:async(reference,session)=>{const [{createPlanExecutionConsentService},{SESSION_SECRET}]=await Promise.all([import('./plan-execution-consent'),import('../lib/session')]);return createPlanExecutionConsentService({secret:SESSION_SECRET}).status(reference,session);},available:async(session,scopes)=>{const {chatGptReadableTools,chatGptActionTools}=await import('./chatgpt-tool-access');return [...chatGptReadableTools(session,scopes),...chatGptActionTools(session,scopes)].map(t=>t.name);},plan:createCanonicalCalendarPlanner(),...overrides};
 return async(input:unknown,session:SessionPayload,scopes:string[],grantReference:string)=>{
  if(!deps.enabled())throw Error('Background calendar planning unavailable');const request=inputSchema.parse(input);
  if(!session.userId||!session.activeMembershipId||!session.sv||!grantReference||session.role==='admin')throw Error('Current operational connection required');
  const current=await deps.available(session,scopes);if(required.some(name=>!current.includes(name)))throw Error('Current calendar reads and preparation permission required');
  // status performs fresh canonical task/plan/grant verification. Never metadata fallback.
  const run=await deps.status(request.reference,session),a=run.authorization;
  if(run.cancelRequested||run.state==='cancelled')throw Error('Saved delegation no longer available for planning');
  const company=session.role==='partner'&&session.partnerId?`partner:${session.partnerId}`:session.vendorId?`vendor:${session.vendorId}`:null;
  if(a.id!==request.reference||a.grantReference!==grantReference||a.requester.userId!==session.userId||a.requester.organizationKey!==company||a.requester.membershipId!==session.activeMembershipId||a.requester.sessionVersion!==session.sv)throw Error('Saved delegation connection or account changed');
  const result=await deps.plan(a,request.preferences);
  return outputSchema.parse({reference:request.reference,...result,executionStarted:false as const,calendarChangesSaved:false as const,messagesSent:false as const,delegationExpanded:false as const});
 };
}
export const handlePlanExecutionCalendarTool=createPlanExecutionCalendarHandler();
