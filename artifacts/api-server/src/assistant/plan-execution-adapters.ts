import { z } from 'zod/v4';
import { PLAN_EXECUTION_READ_TOOL_NAMES } from './plan-execution-read-policy';
import { planExecutionResultSchema, type PlanExecutionAdapter, type PlanExecutionAuthorization, type PlanExecutionResult, type PlanExecutionStep, type PlanExecutionReconciliation } from './plan-execution';

const readTools=new Set(PLAN_EXECUTION_READ_TOOL_NAMES);
const personalDraftInput=z.object({title:z.string().trim().min(1).max(200)}).strict();
export type PersonalDraftCommand={operationId:string;title:string;description:string;assigneeUserId:number};
export interface PlanExecutionCanonicalApi{
 /** The implementation must recheck current actor/tool authority and return bounded server-derived source references. */
 read(authorization:PlanExecutionAuthorization,step:PlanExecutionStep):Promise<PlanExecutionResult>;
 /** Current authorized exact durable command lookup. not_found only for a proven absent same UUID. */
 readbackDraft(authorization:PlanExecutionAuthorization,command:PersonalDraftCommand):Promise<PlanExecutionReconciliation>;
 /** Save through canonical Work Hub command+receipt+current exact readback; no interactive-confirm spoof. */
 savePersonalDraft(authorization:PlanExecutionAuthorization,command:PersonalDraftCommand):Promise<PlanExecutionResult>;
 prepareTicketInvoices?(authorization:PlanExecutionAuthorization,step:PlanExecutionStep,readback:boolean):Promise<PlanExecutionReconciliation>;
}
/** Retrieved text is literal record data. No model interpretation, instruction following, recipients or external effects. */
export function personalDraftDescription(results:PlanExecutionResult[]):string{
 if(!results.length)throw Error('Personal draft requires completed source reads');
 const text=['Recorded read results — review before taking action.',...results.map(r=>`${r.summary}\nSource references: ${r.sourceReferences.join(', ')}`)].join('\n\n');
 if(text.length>12000)throw Error('Personal draft exceeds bounded capacity');return text;
}
export function createPlanExecutionAdapters(api:PlanExecutionCanonicalApi):Record<PlanExecutionStep['adapter'],PlanExecutionAdapter>{
 function assertRead(step:PlanExecutionStep){if(!readTools.has(step.toolName))throw Error('Unsupported unattended read tool');}
 function command(context:Parameters<PlanExecutionAdapter['execute']>[0],step:PlanExecutionStep):PersonalDraftCommand{
  if(step.toolName!=='manage_work_hub_task')throw Error('Unsupported personal draft tool');
  const args=personalDraftInput.parse(step.arguments);
  return {operationId:step.operationId,title:args.title,description:personalDraftDescription(context.results),assigneeUserId:context.authorization.requester.userId};
 }
 return {
  authorized_read:{async execute(context,step){assertRead(step);return planExecutionResultSchema.parse(await api.read(context.authorization,step));},async reconcile(_context,step){assertRead(step);return {state:'not_found'};}},
  personal_draft:{async execute(context,step){return planExecutionResultSchema.parse(await api.savePersonalDraft(context.authorization,command(context,step)));},async reconcile(context,step){return api.readbackDraft(context.authorization,command(context,step));}},
  ticket_invoice_preparation:{async execute(context,step){if(!api.prepareTicketInvoices)throw Error('Invoice preparation unavailable');const result=await api.prepareTicketInvoices(context.authorization,step,false);if(result.state!=='completed')throw Error('Invoice preparation outcome unverified');return result.result;},async reconcile(context,step){if(!api.prepareTicketInvoices)throw Error('Invoice preparation unavailable');return api.prepareTicketInvoices(context.authorization,step,true);}},
 };
}
