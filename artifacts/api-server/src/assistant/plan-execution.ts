import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { TICKET_INVOICE_PREPARATION_ARGUMENTS } from './ticket-invoice-preparation-tools';
import { PLAN_EXECUTION_OPPORTUNITY_INPUTS } from './plan-execution-read-policy';
import { PLAN_EXECUTION_READ_TOOL_NAMES, PLAN_EXECUTION_BUSINESS_READ_CANDIDATES, PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT } from './plan-execution-read-policy';

const jsonObject = z.record(z.string(), z.json());
export const planExecutionRequesterSchema = z.object({userId:z.number().int().positive(),organizationKey:z.string().regex(/^(vendor|partner):[1-9]\d*$/),membershipId:z.number().int().positive(),sessionVersion:z.number().int().positive()}).strict();
export const planExecutionStepSchema = z.object({id:z.string().min(1).max(100),adapter:z.enum(['authorized_read','personal_draft','ticket_invoice_preparation']),toolName:z.string().min(1).max(150),arguments:jsonObject,dependsOn:z.array(z.string().min(1).max(100)).max(20),operationId:z.string().uuid()}).strict();
export const planExecutionAuthorizationSchema = z.object({id:z.string().uuid(),requester:planExecutionRequesterSchema,grantReference:z.string().min(1).max(200),taskId:z.string().uuid(),taskVersion:z.number().int().positive(),planId:z.string().uuid(),planVersion:z.number().int().positive(),planFingerprint:z.string().regex(/^[a-f0-9]{64}$/),approvedAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),maxAttempts:z.number().int().min(1).max(5),steps:z.array(planExecutionStepSchema).min(1).max(20),notificationOperationId:z.string().uuid()}).strict().superRefine((a,ctx)=>{
 const ids=new Set(a.steps.map(s=>s.id)),ops=new Set(a.steps.map(s=>s.operationId));
 if(ids.size!==a.steps.length||ops.size!==a.steps.length||ops.has(a.notificationOperationId))ctx.addIssue({code:'custom',message:'Step and operation IDs must be unique'});
 if(a.expiresAt<=a.approvedAt||a.expiresAt-a.approvedAt>24*3600_000)ctx.addIssue({code:'custom',message:'Approval must expire within 24 hours'});
 const active=new Set<string>(),done=new Set<string>();
 function visit(id:string):boolean{if(active.has(id))return false;if(done.has(id))return true;const s=a.steps.find(s=>s.id===id);if(!s)return false;active.add(id);if(!s.dependsOn.every(visit))return false;active.delete(id);done.add(id);return true;}
 if(!a.steps.every(s=>visit(s.id)))ctx.addIssue({code:'custom',message:'Invalid dependency graph'});
 if(a.steps.some(s=>Buffer.byteLength(JSON.stringify(s.arguments))>8192))ctx.addIssue({code:'custom',message:'Approved arguments exceed bounded capacity'});
 for(const step of a.steps){
  if(step.adapter==='authorized_read'&&Object.hasOwn(PLAN_EXECUTION_OPPORTUNITY_INPUTS,step.toolName)&&!PLAN_EXECUTION_OPPORTUNITY_INPUTS[step.toolName as keyof typeof PLAN_EXECUTION_OPPORTUNITY_INPUTS].safeParse(step.arguments).success)ctx.addIssue({code:'custom',message:'Invalid exact opportunity read arguments'});
  if(step.adapter==='ticket_invoice_preparation') {
   const args=TICKET_INVOICE_PREPARATION_ARGUMENTS.safeParse(step.arguments);
   if(step.toolName!=='prepare_ticket_invoices'||!args.success||!step.dependsOn.some(id=>a.steps.some(read=>read.id===id&&read.adapter==='authorized_read'&&read.toolName==='query_invoice_activity'&&read.arguments.basis===args.data?.basis)))ctx.addIssue({code:'custom',message:'Invoice preparation requires exact selections and matching approved chronology dependency'});
  }
  if(step.adapter==='authorized_read'&&!PLAN_EXECUTION_READ_TOOL_NAMES.includes(step.toolName))ctx.addIssue({code:'custom',message:'Unsupported unattended read tool'});
  if(step.adapter==='authorized_read'&&step.toolName==='query_invoice_activity'&&!PLAN_EXECUTION_INVOICE_ACTIVITY_INPUT.safeParse(step.arguments).success)ctx.addIssue({code:'custom',message:'Invalid invoice activity basis'});
  if(step.adapter==='authorized_read'&&step.toolName!=='query_asset_custody'&&Object.hasOwn(PLAN_EXECUTION_BUSINESS_READ_CANDIDATES,step.toolName)&&!PLAN_EXECUTION_BUSINESS_READ_CANDIDATES[step.toolName as keyof typeof PLAN_EXECUTION_BUSINESS_READ_CANDIDATES].safeParse(step.arguments).success)ctx.addIssue({code:'custom',message:'Invalid bounded business read arguments'});
  if(step.adapter==='personal_draft'&&(step.toolName!=='manage_work_hub_task'||!z.object({title:z.string().trim().min(1).max(200)}).strict().safeParse(step.arguments).success||!step.dependsOn.length||step.dependsOn.some(id=>a.steps.find(s=>s.id===id)?.adapter!=='authorized_read')))ctx.addIssue({code:'custom',message:'Personal draft requires title-only bounds and source read dependencies'});
 }
});
export type PlanExecutionAuthorization=z.infer<typeof planExecutionAuthorizationSchema>;
export type PlanExecutionStep=z.infer<typeof planExecutionStepSchema>;
export const planExecutionResultSchema=z.object({operationId:z.string().uuid(),sourceReferences:z.array(z.string().min(1).max(300)).min(1).max(100),summary:z.string().min(1).max(8000)}).strict();
export type PlanExecutionResult=z.infer<typeof planExecutionResultSchema>;
export const planExecutionRunSchema=z.object({authorization:planExecutionAuthorizationSchema,authorizationHash:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().nonnegative(),state:z.enum(['pending','running','completed','blocked','cancelled','outcome_unknown']),cancelRequested:z.boolean(),steps:z.array(z.object({id:z.string(),state:z.enum(['pending','running','completed','outcome_unknown']),attempts:z.number().int().nonnegative(),reconciliationAttempts:z.number().int().nonnegative().default(0),result:planExecutionResultSchema.optional()}).strict()),brief:z.string().max(20000).optional(),notificationSaved:z.boolean(),notificationAttempts:z.number().int().nonnegative().default(0),detail:z.string().max(1000).optional()}).strict();
export type PlanExecutionRun=z.infer<typeof planExecutionRunSchema>;
export function planExecutionFingerprint(value:unknown):string{
 function ordered(v:unknown):unknown{if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)]));return v;}
 return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
export function createPlanExecution(value:unknown):PlanExecutionRun{const authorization=planExecutionAuthorizationSchema.parse(value);return {authorization,authorizationHash:planExecutionFingerprint(authorization),revision:0,state:'pending',cancelRequested:false,steps:authorization.steps.map(s=>({id:s.id,state:'pending',attempts:0,reconciliationAttempts:0})),notificationSaved:false,notificationAttempts:0};}
export type PlanExecutionClaim={run:PlanExecutionRun;fence:number;leaseUntil:number};
export interface PlanExecutionRepository{
 /** Claim due records exclusively; recover expired claims without resetting running steps. */
 claimNext(now:number,leaseUntil:number):Promise<PlanExecutionClaim|null>;
 /** Atomically require exact fence/revision/unexpired lease, immutable authorization hash and no concurrent cancel. */
 commit(claim:PlanExecutionClaim,expectedRevision:number,next:PlanExecutionRun,now:number):Promise<boolean>;
 release(claim:PlanExecutionClaim):Promise<void>;
}
export type PlanExecutionCurrentAuthorization=z.infer<typeof planExecutionRequesterSchema>&{grantReference:string;grantRevoked:boolean;taskId:string;taskVersion:number;planId:string;planVersion:number;planFingerprint:string;availableTools:string[]};
export type PlanExecutionContext={authorization:PlanExecutionAuthorization;results:PlanExecutionResult[]};
export type PlanExecutionReconciliation={state:'completed';result:PlanExecutionResult}|{state:'not_found'}|{state:'unknown'};
export interface PlanExecutionAdapter{
 execute(context:PlanExecutionContext,step:PlanExecutionStep):Promise<PlanExecutionResult>;
 /** not_found means canonical current authorized operation lookup proves absent; errors must not become not_found. */
 reconcile(context:PlanExecutionContext,step:PlanExecutionStep):Promise<PlanExecutionReconciliation>;
}
export interface PlanExecutorDependencies{
 repository:PlanExecutionRepository;now:()=>number;
 /** Fresh database session, grant, scopes and exact authorized task/plan read. No cached token authority. */
 authorize(authorization:PlanExecutionAuthorization):Promise<PlanExecutionCurrentAuthorization>;
 adapters:Record<PlanExecutionStep['adapter'],PlanExecutionAdapter>;
 /** Durable self-only notification, deduplicated by exact operationId and immutable brief. */
 notify(authorization:PlanExecutionAuthorization,operationId:string,brief:string):Promise<{saved:true;operationId:string}>;
}
function assertRun(run:PlanExecutionRun){
 planExecutionRunSchema.parse(run);
 if(planExecutionFingerprint(run.authorization)!==run.authorizationHash||run.steps.length!==run.authorization.steps.length||run.steps.some((s,i)=>s.id!==run.authorization.steps[i].id||(s.state==='completed'&&(!s.result||s.result.operationId!==run.authorization.steps[i].operationId||run.authorization.steps[i].dependsOn.some(id=>run.steps.find(d=>d.id===id)?.state!=='completed')))))throw Error('Invalid persisted execution binding');
}
function assertCurrent(a:PlanExecutionAuthorization,c:PlanExecutionCurrentAuthorization,now:number){
 if(now>=a.expiresAt)throw Error('Delegation expired');
 if(c.grantRevoked||c.grantReference!==a.grantReference||Object.entries(a.requester).some(([k,v])=>c[k as keyof typeof c]!==v)||c.taskId!==a.taskId||c.taskVersion!==a.taskVersion||c.planId!==a.planId||c.planVersion!==a.planVersion||c.planFingerprint!==a.planFingerprint||a.steps.some(s=>!c.availableTools.includes(s.toolName)))throw Error('Current delegation authority or plan changed');
}
/** Executes only explicit immutable adapters. It never generates an approval phrase or invokes an LLM. */
export function createPlanExecutor(deps:PlanExecutorDependencies){return {async runOne():Promise<boolean>{
 const claim=await deps.repository.claimNext(deps.now(),deps.now()+60_000);if(!claim)return false;
 let run=structuredClone(claim.run);
 const save=async(next:PlanExecutionRun)=>{next.revision=run.revision+1;assertRun(next);if(!await deps.repository.commit(claim,run.revision,next,deps.now()))throw Error('Execution lease, revision or cancellation changed');run=structuredClone(next);claim.run=structuredClone(next);};
 const fresh=async()=>{if(run.cancelRequested)throw Error('Execution cancelled');assertCurrent(run.authorization,await deps.authorize(run.authorization),deps.now());if(deps.now()>=claim.leaseUntil)throw Error('Execution lease expired');};
 try{
  assertRun(run);if(run.cancelRequested){return true;}if(['completed','blocked','cancelled'].includes(run.state))return true;
  try{await fresh();}catch{await save({...run,state:'blocked',detail:'Current authority, expiry or saved plan no longer permits execution'});return true;}
  for(let count=0;count<run.steps.length;count++){
   const index=run.steps.findIndex(s=>s.state!=='completed'&&run.authorization.steps.find(p=>p.id===s.id)!.dependsOn.every(id=>run.steps.find(d=>d.id===id)?.state==='completed'));if(index<0)break;
   const step=run.authorization.steps[index],state=run.steps[index],adapter=deps.adapters[step.adapter];
   await fresh();
   const context={authorization:run.authorization,results:step.dependsOn.map(id=>run.steps.find(s=>s.id===id)!.result!)};
   let result:PlanExecutionResult|undefined;
   if(state.state==='running'||state.state==='outcome_unknown'){
    if(state.reconciliationAttempts>=run.authorization.maxAttempts){await save({...run,state:'blocked',detail:'Canonical outcome unknown; bounded reconciliation exhausted'});return true;}
    const retry=structuredClone(run);retry.steps[index].reconciliationAttempts++;await save(retry);await fresh();
    let reconciled:PlanExecutionReconciliation;
    try{reconciled=await adapter.reconcile(context,step);}catch{await save({...run,state:'outcome_unknown',detail:'Canonical reconciliation unavailable; no command was resent'});return true;}
    await fresh();
    if(reconciled.state==='unknown'){await save({...run,state:'outcome_unknown',detail:'Canonical outcome remains unknown'});return true;}
    if(reconciled.state==='completed')result=reconciled.result;
   }
   if(!result){
    if(state.attempts>=run.authorization.maxAttempts){await save({...run,state:'blocked',detail:'Bounded attempts exhausted'});return true;}
    const next=structuredClone(run);next.state='running';next.steps[index].state='running';next.steps[index].attempts++;await save(next);await fresh();
    try{result=await adapter.execute(context,step);}catch{const unknown=structuredClone(run);unknown.state='outcome_unknown';unknown.steps[index].state='outcome_unknown';unknown.detail='Command may have committed; exact canonical reconciliation required';await save(unknown);return true;}
   }
   result=planExecutionResultSchema.parse(result);if(result.operationId!==step.operationId)throw Error('Receipt operation mismatch');await fresh();
   const next=structuredClone(run);next.steps[index].state='completed';next.steps[index].result=result;next.detail=undefined;await save(next);
  }
  if(!run.steps.every(s=>s.state==='completed')){await save({...run,state:'blocked',detail:'Dependency results unavailable'});return true;}
  const brief=run.brief??['Saved plan execution results',...run.steps.map(s=>`${s.id}: ${s.result!.summary}\nSources: ${s.result!.sourceReferences.join(', ')}`)].join('\n\n');
  if(brief.length>20000){await save({...run,state:'blocked',detail:'Return brief exceeds bounded capacity'});return true;}
  if(!run.brief)await save({...run,brief});await fresh();
  if(!run.notificationSaved){
   if(run.notificationAttempts>=run.authorization.maxAttempts){await save({...run,state:'blocked',detail:'Return brief outcome unknown; bounded notification retry exhausted'});return true;}
   await save({...run,notificationAttempts:run.notificationAttempts+1});await fresh();
   try{const receipt=await deps.notify(run.authorization,run.authorization.notificationOperationId,brief);if(receipt.saved!==true||receipt.operationId!==run.authorization.notificationOperationId)throw Error('Notification receipt mismatch');await fresh();await save({...run,notificationSaved:true});}catch{await save({...run,state:'outcome_unknown',detail:'Return brief notification requires exact deduplicated retry'});return true;}
  }
  await save({...run,state:'completed',detail:undefined});return true;
 }catch{
  // A lost lease/cancel fence prevents publication. Persisted running state is recoverable through reconciliation.
  try{await save({...run,state:'blocked',detail:'Execution stopped; current authorization or canonical readback failed'});}catch{/* another owner/cancellation now controls the record */}
  return true;
 }finally{await deps.repository.release(claim);}
 }};}
