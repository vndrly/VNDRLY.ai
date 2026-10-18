import {it,expect} from "vitest";
import * as contracts from "./index";
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const at="2026-10-16T18:00:00Z";
const scope={owner:{type:"vendor",id:11},userId:7,membershipId:9,sessionVersion:2,deviceId:"synthetic-device",provisioningId:id(1)};
const ref=(kind:string,n:number,type="local")=>({type,kind,id:id(n),...(type==="canonical"?{version:1}:{})});
function schema(name:string):any{const value=(contracts as any)[name];expect(value,name).toBeDefined();return value;}
const base=()=>({version:2,operationId:id(2),scope,capturedAt:at,timeZone:"America/Chicago",dependencies:[]});
it("requires explicit revisioned quantity review and derives reviewer identity from the original session",()=>{
 const commands=schema("FleetWorkCommandSchema"),selection={evidenceId:id(31),expectedReviewRevision:0,decision:"accept_as_billable",reason:"Office checked receipt"};
 const command={...base(),kind:"quantity.review",payload:{activity:ref("activity",30,"canonical"),ticket:{type:"canonical",kind:"ticket",id:123,version:1},selections:[selection]}};
 expect(commands.safeParse(command).success).toBe(true);
 for(const payload of [{...command.payload,reviewedByUserId:999},{...command.payload,selections:[]},{...command.payload,selections:[selection,selection]},{...command.payload,selections:[{...selection,expectedReviewRevision:-1}]},{...command.payload,selections:[{...selection,quantity:"999"}]}])expect(commands.safeParse({...command,payload}).success).toBe(false);
});
it("distinguishes a new local location identity from an edit of a canonical saved location",()=>{
 const commands=schema("FleetWorkCommandSchema"),payload={operationId:id(2),expectedVersion:1,localReference:ref("location",44),destination:{name:"New yard",kind:"yard",address:"Synthetic yard",latitude:null,longitude:null,active:true}};
 expect(commands.safeParse({...base(),kind:"location.save",payload}).success).toBe(true);
 expect(commands.safeParse({...base(),kind:"location.save",payload:{...payload,destination:{...payload.destination,id:id(45)}}}).success).toBe(false);
 expect(commands.safeParse({...base(),kind:"location.save",payload:{...payload,localReference:null,destination:{...payload.destination,id:id(45)}}}).success).toBe(true);
 expect(commands.safeParse({...base(),kind:"location.save",payload:{...payload,localReference:undefined}}).success).toBe(false);
});
function creation(){
 const truck=id(5),detail=id(6),point={type:"provisional",localId:id(7),name:"Synthetic origin",address:"1 Yard Road",latitude:null,longitude:null,capturedAt:at};
 return {...base(),kind:"activity.create",payload:{activityId:id(3),title:"Haul crude",detailReference:ref("detail",6,"canonical"),detailSnapshot:{detail:{id:detail,companyId:11,version:1,name:"Driver / service truck",vehicleAssetId:truck,rigPackageId:null,rigPackageVersion:null,driverUserId:7,accessGroupIds:[id(8)],effectiveFrom:at,effectiveUntil:null,archivedAt:null},rigPackage:null,labels:{truck:"Truck",driver:"Synthetic driver",rigPackage:null,components:[]},carrierOfRecordId:11,snapshottedAt:at},route:{origin:point,stops:[{id:id(9),kind:"delivery",sequence:0,cycleId:null,location:{...point,localId:id(10),name:"Synthetic destination"}}],returnPolicy:"delivery_only",base:null,plannedWindow:null},runOrderReference:null,billing:{choice:"new_ticket",ticket:ref("ticket",4),partnerId:12,billingSiteId:13,afeNumber:"AFE-1",workDate:"2026-10-16",currency:"USD",serviceId:null,agreementReference:null},pricingIntent:{mode:"unpriced",reason:"offline_reference_missing",serviceId:null,approvalRef:null},capturePolicy:null,compliance:{mode:"warn_only",status:"red",evaluatedAt:at,warnings:[{category:"regulatory_review",reason:"unverified"}]}}};
}
it("builds durable create intent from the actual Detail and explicit new/shared ticket choice without starting the driver",async()=>{
 const c=creation(),p=c.payload,build=(contracts as any).buildFleetCreateIntent;expect(build).toBeTypeOf("function");
 const place=(n:number)=>({type:"canonical",location:{id:id(n),revision:1,name:"Synthetic location",kind:n===18?"pickup":"delivery",address:"1 Yard Road",latitude:null,longitude:null,active:true,ownerType:"vendor",ownerId:11}});
 const route=(contracts as any).FleetRoutePlanSchema.parse({...p.route,origin:place(18),stops:p.route.stops.map(s=>({...s,location:place(19)}))}),input={operationId:id(2),fleetId:id(8),title:p.title,driverUserId:7,vehicleAssetId:id(5),trailerAssetId:null,detailSelection:{version:2,detailId:id(6),detailVersion:1,timeZone:"America/Chicago",returnPolicy:"delivery_only"},routePlan:route,billing:{mode:"new_ticket",workTypeId:14,afeNumber:"AFE-1",workDate:"2026-10-16"},stops:(contracts as any).fleetRouteOperationalStops(route,13,id(17))};
 const preparation={snapshot:p.detailSnapshot,billingSiteId:13,partnerId:12,ticket:null},options={scope,preparation,input,now:()=>new Date(at),uuid:()=>id(99)};
 const created=build(options);expect(created).toMatchObject({kind:"activity.create",capturedAt:new Date(at).toISOString(),payload:{billing:{choice:"new_ticket",serviceId:14,ticket:{type:"local"}},compliance:{mode:"warn_only",status:"red"}}});expect(created.payload.driverAcknowledged).toBeUndefined();expect(created.payload.driverStarted).toBeUndefined();
 const existing=build({...options,input:{...input,billing:{mode:"existing_ticket",workTypeId:14,ticketId:123,afeNumber:"AFE-1",workDate:"2026-10-16"}},preparation:{...preparation,ticket:{id:123,version:9,serviceId:14}}});expect(existing.payload.billing.ticket).toEqual({type:"canonical",kind:"ticket",id:123,version:9});
 expect(()=>build({...options,input:{...input,driverUserId:999}})).toThrow("Detail");expect(()=>build({...options,preparation:{...preparation,ticket:{id:999,version:9,serviceId:14}},input:{...input,billing:{mode:"existing_ticket",workTypeId:14,ticketId:123,afeNumber:"AFE-1",workDate:"2026-10-16"}}})).toThrow("ticket");
 const rows=new Map<string,string>(),storage={transaction:async(work:any)=>work({get:async(k:string,key:string)=>rows.get(`${k}:${key}`)??null,set:async(k:string,key:string,v:string)=>{rows.set(`${k}:${key}`,v)},values:async(k:string)=>[...rows].filter(([key])=>key.startsWith(`${k}:`)).map(([,v])=>v)})},clientScope={...scope,deviceId:id(99)};
 const journal=(contracts as any).createDurableFleetWorkJournal({scope:clientScope,storage,isCurrent:()=>true,digest:async()=>"a".repeat(64)});
 let sent=0,retentionAttempts=0;const http=async(path:string)=>{if(path.endsWith("capabilities"))return {enabled:true};if(path.endsWith("devices/register"))return {id:id(99)};if(path.endsWith("provision"))return {scope:clientScope,expiresAt:"2026-10-24T18:00:00Z"};if(path.endsWith("prepare-create"))return preparation;if(path.includes("operations/"))return {receipt:null,checkedAt:new Date().toISOString()};if(path.endsWith("originals")){retentionAttempts++;throw Error("offline");}sent++;throw Error("offline");};
 const open=()=> (contracts as any).openFleetWorkSession({account:{userId:7,companyId:11,membershipId:9,sessionVersion:2},index:storage,openJournal:async()=>journal,http,uuid:()=>id(99),isCurrent:()=>true});const client=await open();
 expect(await client.captureCreate(input)).toMatchObject({canonicalApplied:false,state:"outcome_unknown"});const original=(await journal.readState()).entries[0].command;
 await (await open()).captureCreate(input);expect((await journal.readState()).entries[0].command).toEqual(original);expect(sent).toBe(2);expect(retentionAttempts).toBe(2);await expect(client.captureCreate({...input,title:"Changed original operation"})).rejects.toThrow("original");
});
it("binds draft edits to the original operation, assignment and activity revision",()=>{
 const commands=schema("FleetWorkCommandSchema"),created=creation();
 const payload={activity:ref("activity",3,"canonical"),ticket:{type:"canonical",kind:"ticket",id:123,version:1},baseAssignment:created.payload.detailSnapshot,edit:{operationId:id(2),expectedVersion:1,title:"Corrected transport instructions"}};
 const command={...base(),kind:"activity.edit",payload};
 expect(commands.safeParse(command).success).toBe(true);
 expect(commands.safeParse({...command,payload:{...payload,activity:ref("activity",3),edit:{...payload.edit,expectedVersion:2}}}).success).toBe(true);
 for(const bad of [
  {...payload,edit:{...payload.edit,operationId:id(99)}},
  {...payload,edit:{...payload.edit,expectedVersion:2}},
  {...payload,baseAssignment:{...payload.baseAssignment,carrierOfRecordId:99}},
  {...payload,edit:{...payload.edit,driverStarted:true}},
 ])expect(commands.safeParse({...command,payload:bad}).success).toBe(false);
});
it("distinguishes pending local tickets from canonical integer ticket numbers without coercion",()=>{
 const references=schema("FleetWorkReferenceSchema"),label=(contracts as any).fleetWorkReferenceLabel;
 expect(references.parse(ref("ticket",4))).toEqual(ref("ticket",4));expect(label(ref("ticket",4))).toBe("Local ticket — pending sync");
 expect(label({type:"canonical",kind:"ticket",id:123,version:2})).toBe("Ticket #123");
 expect(references.safeParse({...ref("ticket",4,"canonical")}).success).toBe(false);expect(references.safeParse({type:"canonical",kind:"activity",id:123,version:1}).success).toBe(false);
});
it("captures new-ticket and shared-ticket activity choices with real cross-plan snapshots and unresolved pricing",()=>{
 const commands=schema("FleetWorkCommandSchema"),command=creation();expect(commands.parse(command).payload.billing.choice).toBe("new_ticket");
 expect(commands.parse({...command,payload:{...command.payload,billing:{...command.payload.billing,choice:"existing_ticket",ticket:{type:"canonical",kind:"ticket",id:123,version:4}}}}).payload.billing.ticket.id).toBe(123);
 for(const bad of [{...command,payload:{...command.payload,billing:undefined}},{...command,payload:{...command.payload,billing:{...command.payload.billing,ticket:{type:"canonical",kind:"ticket",id:123,version:4}}}},{...command,payload:{...command.payload,detailSnapshot:{...command.payload.detailSnapshot,carrierOfRecordId:12}}},{...command,scope:{...scope,owner:{type:"partner",id:11}}},{...command,payload:{...command.payload,driverAcknowledged:true}}])expect(commands.safeParse(bad).success).toBe(false);
 expect(commands.parse(command).payload.pricingIntent.mode).toBe("unpriced");
});
it("binds shift commands to the same worker/employer/session without turning sign-out into a clock action",()=>{
 const commands=schema("FleetWorkCommandSchema"),payload={operationId:id(2),shiftId:id(30),scope:{owner:scope.owner,userId:7,membershipId:9,sessionVersion:2},action:"start_shift",capturedAt:at,timezone:"America/Chicago"};
 const command={...base(),kind:"workday.event",payload};expect(commands.parse(command).payload.action).toBe("start_shift");
 expect(commands.safeParse({...command,payload:{...payload,scope:{...payload.scope,userId:8}}}).success).toBe(false);
 expect(commands.safeParse({...command,payload:{...payload,action:"logout"}}).success).toBe(false);
 expect(commands.safeParse({...command,payload:{...payload,operationId:id(31)}}).success).toBe(false);
 const owner={type:"partner",id:11};expect(commands.parse({...command,scope:{...scope,owner},payload:{...payload,scope:{...payload.scope,owner}}}).payload.scope.owner.type).toBe("partner");
});
it("requires exact original identity and typed payloads, and rejects impersonation or model-supplied grants",()=>{
 const commands=schema("FleetWorkCommandSchema"),command=creation();
 for(const bad of [{...command,scope:{...scope,roles:["admin"]}},{...command,scope:{...scope,sessionVersion:undefined}},{...command,payload:{runId:id(3),action:"whatever"}},{...command,dependencies:[command.operationId]}])expect(commands.safeParse(bad).success).toBe(false);
});
it("retains the explicit capture policy or unresolved red status without inventing an exemption when a future policy changes",()=>{
 const commands=schema("FleetWorkCommandSchema"),command=creation();expect(commands.safeParse(command).success).toBe(true);const {capturePolicy:_,...missing}=command.payload;expect(commands.safeParse({...command,payload:missing}).success).toBe(false);expect(commands.safeParse({...command,payload:{...command.payload,compliance:{...command.payload.compliance,status:"green",warnings:[]}}}).success).toBe(false);
 const policy={...contracts.resolveFleetCompliancePolicy({partnerId:12,siteId:13,contractId:null,workTypeId:null,at,policies:[]}),mode:"enforced",activatedByUserId:7,notice:"Synthetic future-policy capture"};
 expect(commands.safeParse({...command,payload:{...command.payload,capturePolicy:policy,compliance:{...command.payload.compliance,mode:"enforced"}}}).success).toBe(true);expect(commands.safeParse({...command,payload:{...command.payload,capturePolicy:policy}}).success).toBe(false);
});
it("stages private compliance document metadata separately from activity photos and refuses embedded document bytes",()=>{
 const commands=schema("FleetWorkCommandSchema"),command={...base(),kind:"compliance.document.stage",payload:{recordId:id(40),subject:{kind:"driver",id:7},expectedRecordVersion:0,evidence:ref("evidence",41),byteSize:100,sha256:"a".repeat(64),contentType:"application/pdf"}};expect(commands.safeParse(command).success).toBe(true);expect(commands.safeParse({...command,payload:{...command.payload,bodyBase64:"PRIVATE"}}).success).toBe(false);
});
it("offers narrow office resolutions while retaining original ticket context and refusing implicit reopening",()=>{
 const commands=schema("FleetWorkCommandSchema"),payload={caseId:id(50),expectedVersion:2,activity:ref("activity",3,"canonical"),originalTicket:{type:"canonical",kind:"ticket",id:123,version:4},reason:"Office reviewed original performed work",resolution:{kind:"link_open_ticket",ticket:{type:"canonical",kind:"ticket",id:456,version:2}}};
 expect(commands.safeParse({...base(),kind:"activity.reconcile",payload}).success).toBe(true);expect(commands.safeParse({...base(),kind:"activity.reconcile",payload:{...payload,resolution:{kind:"reopen_ticket",ticketId:123}}}).success).toBe(false);
 expect(commands.safeParse({...base(),kind:"activity.reconcile",payload:{...payload,resolution:{kind:"create_ticket",billing:creation().payload.billing}}}).success).toBe(true);
 expect(commands.safeParse({...base(),kind:"activity.reconcile",payload:{...payload,resolution:{kind:"create_ticket",billing:{...creation().payload.billing,choice:"existing_ticket"}}}}).success).toBe(false);
});
it("resolves missing pricing only through an explicit original office command without a caller supplied rate",()=>{
 const commands=schema("FleetWorkCommandSchema"),payload={activity:ref("activity",30,"canonical"),ticket:{type:"canonical",kind:"ticket",id:123,version:1},expectedVersion:1,reason:"Resolve saved authorized agreement"};
 expect(commands.safeParse({...base(),kind:"price.resolve",payload}).success).toBe(true);
 expect(commands.safeParse({...base(),kind:"price.resolve",payload:{...payload,unitRate:"0"}}).success).toBe(false);
});
it("requires original replacement and cargo commands without granting a dispatcher the driver's acceptance",()=>{
 const commands=schema('FleetWorkCommandSchema'),baseAssignment=creation().payload.detailSnapshot,payload={activity:ref('activity',3,'canonical'),ticket:{type:'canonical',kind:'ticket',id:123,version:1},baseAssignment,input:{operationId:id(2),expectedVersion:1,vehicleAssetId:id(80),trailerAssetId:null,reason:'Reported damage'}};
 expect(commands.safeParse({...base(),kind:'replacement.propose',payload}).success).toBe(true);
 const acceptance={...payload,replacementId:id(81),input:{operationId:id(2),expectedVersion:1,runExpectedVersion:1,action:'accept',notes:'Original assigned driver reports acceptance'}};
 expect(commands.safeParse({...base(),kind:'replacement.action',payload:acceptance}).success).toBe(true);
 expect(commands.safeParse({...base(),scope:{...scope,userId:99},kind:'replacement.action',payload:acceptance}).success).toBe(false);
 expect(commands.safeParse({...base(),kind:'replacement.action',payload:{...acceptance,input:{...acceptance.input,operationId:id(83)}}}).success).toBe(false);
});

it("keeps a newly created offline activity operable through original local references and dependency order",()=>{
 const command:any=creation();command.payload.originStopId=id(33);command.payload.billing.serviceId=14;
 const state:any={sequence:1,command,fingerprint:"a".repeat(64),delivery:{state:"pending",attempts:0}};
 const projected=(contracts as any).projectFleetLocalActivities([state],7,[]);expect(projected).toHaveLength(1);const local=projected[0];expect(local.localWork.ticket).toEqual(command.payload.billing.ticket);expect(local.linkedTicketId).toBeNull();expect(local.resourceAssignment).toBeUndefined();
 const action=(contracts as any).buildFleetActionIntent(scope,local,{operationId:id(35),expectedVersion:1,action:"dispatch"},()=>new Date(at),"UTC");expect(action.payload.activity).toEqual({type:"local",kind:"activity",id:command.payload.activityId});expect(action.payload.ticket).toEqual(command.payload.billing.ticket);expect(action.dependencies).toEqual([command.operationId]);
 const entries=[state,{...state,sequence:2,command:action}];const preview=(contracts as any).previewFleetWorkEntries(local,entries,7);expect(preview.status).toBe("dispatched");expect(preview.allowedActions).toContain("acknowledge");
 expect((contracts as any).projectFleetLocalActivities(entries,999,[])).toEqual([]);
});
