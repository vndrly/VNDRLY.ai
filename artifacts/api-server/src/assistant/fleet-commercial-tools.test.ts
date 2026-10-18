import {expect,it} from "vitest";
import {fleetCommercialToolRequest,FLEET_COMMERCIAL_TOOLS,fleetAuxiliaryToolRequest,FLEET_AUXILIARY_TOOLS} from "./fleet-commercial-tools";
import {resolveExecutableWorkHubToolRequest,bindWorkHubToolScope} from "./work-hub-tool-runtime";
import {chatGptActionTools} from "./chatgpt-tool-access";
import {buildFleetServiceTemplate} from "@workspace/api-zod";
it("binds original commercial operations to the trusted confirmation key and rejects model scope",()=>{
 const input={idempotencyKey:"approved-test",runId:"11111111-1111-4111-8111-111111111111",expectedVersion:3,ticketVersion:2,reason:"Saved approved rate"};
 expect(fleetCommercialToolRequest("resolve_fleet_activity_price",input)).toMatchObject({method:"POST",path:"/fleet/work/assistant",body:{kind:"price.resolve",runId:input.runId,expectedVersion:3}});
 expect(fleetCommercialToolRequest("resolve_fleet_activity_price",{...input,scope:{userId:99}})).toHaveProperty("error");
 expect(new Set(FLEET_COMMERCIAL_TOOLS.map(row=>row.name)).size).toBe(FLEET_COMMERCIAL_TOOLS.length);
});

it("saves only a confirmed catalog-bound template without granting rates or physical work",()=>{
 const template={...buildFleetServiceTemplate({family:"crude_condensate",serviceId:42,serviceName:"Crude haul"}),revision:1};
 expect(fleetCommercialToolRequest("save_fleet_service_template",{idempotencyKey:"template-reviewed",expectedRevision:0,template})).toMatchObject({method:"POST",path:"/fleet/work/assistant",body:{kind:"service_template.save",expectedRevision:0,template:{enabled:false,serviceId:42}}});
 expect(fleetCommercialToolRequest("save_fleet_service_template",{expectedRevision:0,template,scope:{companyId:999}})).toHaveProperty("error");
});

it("records a driver's quantity without demanding unrelated agreement or adjustment documents",()=>{
 const result=fleetCommercialToolRequest("record_fleet_quantity",{idempotencyKey:"quantity-test",runId:"11111111-1111-4111-8111-111111111111",expectedVersion:2,evidence:{kind:"delivered",cycleId:null,quantity:"42",unit:"barrel",source:"manual",evidenceReferences:["synthetic-scale"]}});expect(result).toMatchObject({method:"POST",path:"/fleet/work/assistant",body:{kind:"quantity.record"}});
});

it("keeps partner policy impact read-only and activation confirmation-bound with no model actor",()=>{
 const input={vendorId:7,expectedVersion:0,proposal:{policyId:null,mode:"enforced",scope:{partnerId:9,siteId:null,contractId:null,workTypeId:8},effectiveFrom:"2030-01-01T00:00:00Z",effectiveUntil:null,checkpoints:["start"],notice:"Explicit future notice",existingWorkTreatment:"preserve_capture_policy"}};
 const context={userId:3,role:"partner",partnerId:9,membershipRole:"admin"} as const;
 expect(resolveExecutableWorkHubToolRequest("query_fleet_policy_impact",bindWorkHubToolScope(input,context as never,"query_fleet_policy_impact"),false,context as never)).toMatchObject({method:"POST",path:"/fleet/compliance-policies/7/preview",body:{expectedVersion:0,proposal:input.proposal}});
 expect(fleetAuxiliaryToolRequest("activate_fleet_compliance_policy",{...input,idempotencyKey:"actual-confirmation"})).toMatchObject({method:"POST",path:"/fleet/compliance-policies/7/activate",body:{expectedVersion:0,proposal:input.proposal}});
 expect(fleetAuxiliaryToolRequest("activate_fleet_compliance_policy",{...input,actor:{userId:999}})).toHaveProperty("error");
 expect(FLEET_AUXILIARY_TOOLS.find(t=>t.name==="activate_fleet_compliance_policy")).toMatchObject({roles:["partner"],mutating:true,confirmation:"required",risk:"high"});
 const partner={userId:3,role:"partner",partnerId:9,membershipRole:"admin"} as const;
 expect(chatGptActionTools(partner as never,["fleet:billing"]).some(t=>t.name==="activate_fleet_compliance_policy")).toBe(false);
 expect(chatGptActionTools(partner as never,["fleet:policy"]).some(t=>t.name==="activate_fleet_compliance_policy")).toBe(true);
});
