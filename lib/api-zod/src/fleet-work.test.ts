import {it,expect} from "vitest";
import * as contracts from "./index";
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const at="2026-10-16T18:00:00Z";
const scope={owner:{type:"vendor",id:11},userId:7,membershipId:9,sessionVersion:2,deviceId:"synthetic-device",provisioningId:id(1)};
const ref=(kind:string,n:number,type="local")=>({type,kind,id:id(n),...(type==="canonical"?{version:1}:{})});
function schema(name:string):any{const value=(contracts as any)[name];expect(value,name).toBeDefined();return value;}
const base=()=>({version:2,operationId:id(2),scope,capturedAt:at,timeZone:"America/Chicago",dependencies:[]});
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
