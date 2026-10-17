import {applyFleetAssistantIntent,readFleetAssistantReview,readFleetAssistantRecovery} from "../services/fleet-work-assistant";
import {Router,raw,type Request} from "express";
import {z} from "zod/v4";
import {FleetWorkScopeSchema,FleetWorkReceiptSchema,FleetEvidenceUploadStatusSchema} from "@workspace/api-zod";
import {FleetError} from "../services/fleet-repository";
import type {FleetActor} from "../services/fleet-ops";
import {createDatabaseFleetWorkRepository} from "../services/fleet-work-repository";
import {createFleetWorkService} from "../services/fleet-work";
import {executeFleetWorkCommand} from "../services/fleet-work-canonical";
import {createFleetEvidenceCanonicalHandlers} from "../services/fleet-evidence-upload-canonical";
import {createDatabaseFleetEvidenceUploadRepository} from "../services/fleet-evidence-upload-repository";
import {createFleetEvidenceUploadService} from "../services/fleet-evidence-upload";
import {getObjectStore} from "../lib/objectStore";
import {prepareFleetWorkCreation,readFleetWorkBillingChoices} from "../services/fleet-work-preparation";
import {readFleetCommercialReview} from "../services/fleet-commercial-review";
import {readFleetReconciliation,readFleetRecoveryOptions} from "../services/fleet-reconciliation";
import {createFleetWorkCanonicalService} from "../services/fleet-work-canonical";
const repository=createDatabaseFleetWorkRepository({execute:executeFleetWorkCommand});
const service=createFleetWorkService(repository),handlers=createFleetEvidenceCanonicalHandlers();
const evidence=createFleetEvidenceUploadService(createDatabaseFleetEvidenceUploadRepository(repository,handlers),getObjectStore);
const scopeInput=z.object({scope:FleetWorkScopeSchema}).strict();
/** Only activate after all commercial readers and native/browser reconciliation
 * acceptance gates pass. Provisioning does not grant additional company roles. */
export function createFleetWorkRouter(options:{actor:(req:Request)=>FleetActor;enabled?:()=>boolean;repository?:Pick<typeof repository,"provision"|"readScope">&Partial<Pick<typeof repository,"renewProvision"|"reauthorizeOriginal">>;service?:Pick<typeof service,"read"|"apply">;evidence?:typeof evidence}){
 const router=Router(),repo=options.repository??repository,work=options.service??service,uploads=options.evidence??evidence,enabled=options.enabled??(()=>process.env.FLEET_COMMERCIAL_WORK_V2==="1");
 const endpoint=(operation:(req:Request)=>Promise<unknown>)=>async(req:Request,res:import("express").Response)=>{
  res.setHeader("Cache-Control","no-store");try{if(!enabled())throw new FleetError("fleet.commercial_work_not_activated",409);res.json(await operation(req));}catch(error){if(error instanceof FleetError){res.status(error.status).json({code:error.code});return;}if(error instanceof z.ZodError){res.status(400).json({code:"fleet.invalid_request"});return;}req.log?.error({err:error},"Fleet work request failed");res.status(500).json({code:"fleet.internal_error"});}
 };
 router.get("/fleet/work/capabilities",(req,res)=>{res.setHeader("Cache-Control","no-store");try{options.actor(req);res.json({version:2,enabled:enabled(),complianceMode:"warn_only",offlineRetentionDays:7});}catch(error){res.status(error instanceof FleetError?error.status:500).json({code:"fleet.login_required"});}});
 router.post("/fleet/work/assistant",endpoint(req=>applyFleetAssistantIntent(options.actor(req),req.body)));
 router.post("/fleet/work/assistant/review",endpoint(req=>readFleetAssistantReview(options.actor(req),req.body)));
 router.post("/fleet/work/assistant/recovery",endpoint(req=>readFleetAssistantRecovery(options.actor(req),req.body)));
 router.post("/fleet/work/provision",endpoint(req=>repo.provision(options.actor(req),req.body)));
 router.post("/fleet/work/provision/reauthorize",endpoint(req=>{if(!repo.reauthorizeOriginal)throw new FleetError("fleet.recovery_unavailable",503);return repo.reauthorizeOriginal(options.actor(req),req.body);}));
 router.post("/fleet/work/provision/renew",endpoint(req=>{if(!repo.renewProvision)throw new FleetError("fleet.provision_renewal_unavailable",503);return repo.renewProvision(options.actor(req),req.body);}));
 router.post("/fleet/work/prepare-create",endpoint(req=>{const body=scopeInput.extend({detailId:z.uuid(),billingSiteId:z.number().int().positive(),ticketId:z.number().int().positive().nullable()}).parse(req.body);const {scope,...input}=body;return repo.readScope(options.actor(req),scope,context=>prepareFleetWorkCreation(context,input));}));
 router.post("/fleet/work/commands",endpoint(req=>work.apply(options.actor(req),req.body)));
 router.post("/fleet/work/billing-options",endpoint(req=>{const body=scopeInput.extend({fleetId:z.uuid(),siteId:z.number().int().positive(),afeNumber:z.string(),workDate:z.iso.date()}).parse(req.body);const {scope,...input}=body;return repo.readScope(options.actor(req),scope,context=>readFleetWorkBillingChoices(context,input));}));
 router.post("/fleet/work/reconciliation",endpoint(req=>{const body=scopeInput.extend({after:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}).parse(req.body);return repo.readScope(options.actor(req),body.scope,context=>readFleetReconciliation(context,{after:body.after,limit:body.limit}));}));
 router.post("/fleet/work/reconciliation/:id/options",endpoint(req=>{const body=scopeInput.extend({after:z.uuid().optional()}).parse(req.body);return repo.readScope(options.actor(req),body.scope,context=>readFleetRecoveryOptions(context,z.uuid().parse(req.params.id),body.after));}));
 router.post("/fleet/work/recovery-detail/:id",endpoint(req=>repo.readScope(options.actor(req),scopeInput.parse(req.body).scope,context=>createFleetWorkCanonicalService(context).fleetDetailSnapshot({...context.actor},z.uuid().parse(req.params.id)))));
 router.post("/fleet/work/activities/:id/commercial-review",endpoint(req=>{const body=scopeInput.extend({after:z.string().optional(),limit:z.number().int().min(1).max(100).optional()}).parse(req.body);return repo.readScope(options.actor(req),body.scope,context=>readFleetCommercialReview(context,{activityId:z.uuid().parse(req.params.id),after:body.after,limit:body.limit}));}));
 router.post("/fleet/work/operations/:operationId",endpoint(async req=>({receipt:await work.read(options.actor(req),scopeInput.parse(req.body).scope,z.uuid().parse(req.params.operationId)),checkedAt:new Date().toISOString()})));
 router.post("/fleet/work/evidence/begin",endpoint(req=>uploads.begin(options.actor(req),req.body)));
 router.post("/fleet/work/evidence/:sessionId/status",endpoint(req=>uploads.read(options.actor(req),scopeInput.parse(req.body).scope,z.uuid().parse(req.params.sessionId))));
 router.post("/fleet/work/evidence/:sessionId/receipt",endpoint(async req=>{
  const scope=scopeInput.parse(req.body).scope,id=z.uuid().parse(req.params.sessionId),saved=FleetEvidenceUploadStatusSchema.parse(await uploads.read(options.actor(req),scope,id));
  if(saved.session.id!==id||JSON.stringify(saved.session.scope)!==JSON.stringify(scope))throw new FleetError("fleet.work_scope_changed",403);
  if(!saved.completion)throw new FleetError("fleet.evidence_association_pending",409);
  const session=saved.session,canonical={type:"canonical",kind:"evidence",id:session.canonicalEvidenceId,version:1};
  return FleetWorkReceiptSchema.parse({version:2,scope,operationId:session.operationId,fingerprint:session.fingerprint,recordedAt:saved.completion.completedAt,status:"applied",mappings:[{local:{type:"local",kind:"evidence",id:session.localEvidenceId},canonical}],canonicalReferences:[canonical]});
 }));
 router.post("/fleet/work/evidence/:sessionId/complete",endpoint(req=>{const body=scopeInput.extend({operationId:z.uuid()}).parse(req.body);return uploads.complete(options.actor(req),{...body,sessionId:z.uuid().parse(req.params.sessionId)});}));
 router.put("/fleet/work/evidence/:sessionId/parts/:partNumber",raw({type:"application/octet-stream",limit:"1mb"}),endpoint(req=>{
  const scope=FleetWorkScopeSchema.parse(JSON.parse(z.string().max(3000).parse(req.headers["x-fleet-work-scope"])));
  if(!Buffer.isBuffer(req.body))throw new FleetError("fleet.invalid_evidence_part",400);
  return uploads.put(options.actor(req),{scope,sessionId:z.uuid().parse(req.params.sessionId),partNumber:z.coerce.number().int().nonnegative().parse(req.params.partNumber),sha256:z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers["x-content-sha256"]),bytes:req.body});
 }));
 router.post("/fleet/work/activities/:id/evidence",endpoint(req=>{const body=scopeInput.extend({cursor:z.string().nullable().default(null),limit:z.number().int().min(1).max(100).default(50)}).parse(req.body);return repo.readScope(options.actor(req),body.scope,context=>handlers.readWorkEvidence(context,{...body,activityId:z.uuid().parse(req.params.id)}));}));
 return router;
}
