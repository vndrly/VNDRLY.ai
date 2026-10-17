import {Router,raw,type Request} from "express";
import {z} from "zod/v4";
import {FleetWorkScopeSchema} from "@workspace/api-zod";
import {FleetError} from "../services/fleet-repository";
import type {FleetActor} from "../services/fleet-ops";
import {createDatabaseFleetWorkRepository} from "../services/fleet-work-repository";
import {createFleetWorkService} from "../services/fleet-work";
import {executeFleetWorkCommand} from "../services/fleet-work-canonical";
import {createFleetEvidenceCanonicalHandlers} from "../services/fleet-evidence-upload-canonical";
import {createDatabaseFleetEvidenceUploadRepository} from "../services/fleet-evidence-upload-repository";
import {createFleetEvidenceUploadService} from "../services/fleet-evidence-upload";
import {getObjectStore} from "../lib/objectStore";
const repository=createDatabaseFleetWorkRepository({execute:executeFleetWorkCommand});
const service=createFleetWorkService(repository),handlers=createFleetEvidenceCanonicalHandlers();
const evidence=createFleetEvidenceUploadService(createDatabaseFleetEvidenceUploadRepository(repository,handlers),getObjectStore);
const scopeInput=z.object({scope:FleetWorkScopeSchema}).strict();
/** Only activate after all commercial readers and native/browser reconciliation
 * acceptance gates pass. Provisioning does not grant additional company roles. */
export function createFleetWorkRouter(options:{actor:(req:Request)=>FleetActor;enabled?:()=>boolean;repository?:Pick<typeof repository,"provision"|"readScope">;service?:Pick<typeof service,"read"|"apply">;evidence?:typeof evidence}){
 const router=Router(),repo=options.repository??repository,work=options.service??service,uploads=options.evidence??evidence,enabled=options.enabled??(()=>process.env.FLEET_COMMERCIAL_WORK_V2==="1");
 const endpoint=(operation:(req:Request)=>Promise<unknown>)=>async(req:Request,res:import("express").Response)=>{
  res.setHeader("Cache-Control","no-store");try{if(!enabled())throw new FleetError("fleet.commercial_work_not_activated",409);res.json(await operation(req));}catch(error){if(error instanceof FleetError){res.status(error.status).json({code:error.code});return;}if(error instanceof z.ZodError){res.status(400).json({code:"fleet.invalid_request"});return;}req.log?.error({err:error},"Fleet work request failed");res.status(500).json({code:"fleet.internal_error"});}
 };
 router.get("/fleet/work/capabilities",(req,res)=>{res.setHeader("Cache-Control","no-store");try{options.actor(req);res.json({version:2,enabled:enabled(),complianceMode:"warn_only",offlineRetentionDays:7});}catch(error){res.status(error instanceof FleetError?error.status:500).json({code:"fleet.login_required"});}});
 router.post("/fleet/work/provision",endpoint(req=>repo.provision(options.actor(req),req.body)));
 router.post("/fleet/work/commands",endpoint(req=>work.apply(options.actor(req),req.body)));
 router.post("/fleet/work/operations/:operationId",endpoint(async req=>({receipt:await work.read(options.actor(req),scopeInput.parse(req.body).scope,z.uuid().parse(req.params.operationId)),checkedAt:new Date().toISOString()})));
 router.post("/fleet/work/evidence/begin",endpoint(req=>uploads.begin(options.actor(req),req.body)));
 router.post("/fleet/work/evidence/:sessionId/status",endpoint(req=>uploads.read(options.actor(req),scopeInput.parse(req.body).scope,z.uuid().parse(req.params.sessionId))));
 router.post("/fleet/work/evidence/:sessionId/complete",endpoint(req=>{const body=scopeInput.extend({operationId:z.uuid()}).parse(req.body);return uploads.complete(options.actor(req),{...body,sessionId:z.uuid().parse(req.params.sessionId)});}));
 router.put("/fleet/work/evidence/:sessionId/parts/:partNumber",raw({type:"application/octet-stream",limit:"1mb"}),endpoint(req=>{
  const scope=FleetWorkScopeSchema.parse(JSON.parse(z.string().max(3000).parse(req.headers["x-fleet-work-scope"])));
  if(!Buffer.isBuffer(req.body))throw new FleetError("fleet.invalid_evidence_part",400);
  return uploads.put(options.actor(req),{scope,sessionId:z.uuid().parse(req.params.sessionId),partNumber:z.coerce.number().int().nonnegative().parse(req.params.partNumber),sha256:z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers["x-content-sha256"]),bytes:req.body});
 }));
 router.post("/fleet/work/activities/:id/evidence",endpoint(req=>{const body=scopeInput.extend({cursor:z.string().nullable().default(null),limit:z.number().int().min(1).max(100).default(50)}).parse(req.body);return repo.readScope(options.actor(req),body.scope,context=>handlers.readWorkEvidence(context,{...body,activityId:z.uuid().parse(req.params.id)}));}));
 return router;
}
