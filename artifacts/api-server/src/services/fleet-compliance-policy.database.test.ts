import {randomUUID} from "node:crypto";
import {it,expect} from "vitest";
import {pool} from "@workspace/db";
import {createFleetPricingFixture} from "../test-utils/fleet-pricing";
import type {FleetRun,FleetActionPolicySnapshot} from "@workspace/api-zod";

it("previews and explicitly activates future partner policy with current authority, exact retry and immutable history",async()=>{
 const f=await createFleetPricingFixture();
 const service=await import("./fleet-compliance-policy").catch(()=>null);
 expect(service,"actual partner policy service").not.toBeNull();
 const member=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,partner_id,role) VALUES($1,'partner',$2,'admin') RETURNING id",[f.user,f.partner])).rows[0];
 const actor={userId:f.user,sv:1,role:"partner",partnerId:f.partner,activeMembershipId:member.id};
 const binding={partnerId:f.partner,vendorId:f.vendor};
 const proposal={policyId:null,mode:"enforced",scope:{partnerId:f.partner,siteId:f.site,contractId:null,workTypeId:f.service},effectiveFrom:new Date(Date.now()+3600000).toISOString(),effectiveUntil:null,checkpoints:["dispatch","start","office_submit"],notice:"Future synthetic partner requirement. Existing work keeps its capture policy.",existingWorkTreatment:"preserve_capture_policy"};
 const input={operationId:randomUUID(),expectedVersion:0,proposal};
 const preview=await service!.previewFleetPolicy(actor,binding,input);
 expect(preview).toMatchObject({version:0,existingActivities:0,currentlyRed:0,mode:"enforced"});
 expect((await pool.query("SELECT fleet_compliance_policies FROM partner_vendor_relationships WHERE partner_id=$1 AND vendor_id=$2",[f.partner,f.vendor])).rows[0].fleet_compliance_policies).toBeNull();
 await expect(service!.activateFleetPolicy({...f.manager,partnerId:f.partner},binding,input)).rejects.toMatchObject({status:403});
 await expect(service!.activateFleetPolicy({...actor,sv:999},binding,input)).rejects.toMatchObject({status:403});
 await expect(service!.activateFleetPolicy(actor,binding,{...input,proposal:{...proposal,effectiveFrom:new Date(Date.now()-1000).toISOString()}})).rejects.toMatchObject({status:409});
 const first=await service!.activateFleetPolicy(actor,binding,input);
 expect(first).toMatchObject({version:1,policy:{version:1,mode:"enforced",activatedByUserId:f.user}});
 const ticket=(await pool.query("INSERT INTO tickets(vendor_id,site_location_id,work_type_id) VALUES($1,$2,$3) RETURNING id",[f.vendor,f.site,f.service])).rows[0];
 const client=await pool.connect();try{
  const after=new Date(Date.parse(proposal.effectiveFrom)+1000).toISOString(),before=new Date().toISOString(),snapshot:FleetActionPolicySnapshot={mode:"warn_only",status:"red",evaluatedAt:after,warnings:[{category:"regulatory_review",reason:"unverified"}]};
  const run={id:randomUUID(),companyId:f.vendor,linkedTicketId:ticket.id,events:[]} as unknown as FleetRun;
  expect(await service!.applyFleetPartnerPolicy(client,run,"start",{...snapshot,evaluatedAt:before})).toMatchObject({mode:"warn_only"});
  await expect(service!.applyFleetPartnerPolicy(client,run,"start",snapshot)).rejects.toMatchObject({code:"fleet.partner_compliance_required",status:409});
  expect(await service!.applyFleetPartnerPolicy(client,run,"start",{...snapshot,status:"green",warnings:[]})).toMatchObject({mode:"enforced",policies:[first.policy]});
  // A client-supplied old capture time is not an exemption. Only an actual
  // canonical creation event's server recording establishes existing work.
  expect(await service!.applyFleetPartnerPolicy(client,{...run,events:[{id:randomUUID(),operationId:randomUUID(),actorUserId:f.user,type:"created",recordedAt:before}]} as FleetRun,"start",snapshot)).toMatchObject({mode:"warn_only"});
  expect(await service!.applyFleetPartnerPolicy(client,run,"record_fuel",snapshot)).toEqual(snapshot);
  const checkpoint={id:randomUUID(),operationId:randomUUID(),actorUserId:f.user,type:"created",recordedAt:before,details:{fleetCompliance:snapshot}};
  // Synthetic recorded head for impact SQL only; no driver or physical proof.
  await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','synthetic_policy_preview','fixture','fleet-run',$3,$4::jsonb,'completed')",[f.user,f.vendor,run.id,JSON.stringify({...run,status:"draft",events:[checkpoint]})]);
  expect(await service!.previewFleetPolicy(actor,binding,{...input,expectedVersion:1})).toMatchObject({existingActivities:1,currentlyRed:1});
  await client.query("UPDATE assistant_action_audit SET tool_output=jsonb_set(tool_output,'{events}',$3::jsonb) WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2",[f.vendor,run.id,JSON.stringify([checkpoint,{...checkpoint,id:randomUUID(),details:{fleetCompliance:{...snapshot,status:"green",warnings:[]}}}])]);
  expect(await service!.previewFleetPolicy(actor,binding,{...input,expectedVersion:1})).toMatchObject({existingActivities:1,currentlyRed:0});
 }finally{client.release();}
 expect(service).toHaveProperty("readFleetPolicyActivation");expect(await (service as any).readFleetPolicyActivation(actor,binding,input)).toMatchObject({verified:true,receipt:first});
 expect(await service!.activateFleetPolicy(actor,binding,input)).toEqual(first);
 await expect(service!.activateFleetPolicy(actor,binding,{...input,proposal:{...proposal,notice:"Changed facts"}})).rejects.toMatchObject({status:409});
 await expect(service!.activateFleetPolicy(actor,binding,{...input,operationId:randomUUID()})).rejects.toMatchObject({status:409});
 const second=await service!.activateFleetPolicy(actor,binding,{...input,operationId:randomUUID(),expectedVersion:1,proposal:{...proposal,policyId:first.policy.id,mode:"warn_only",effectiveFrom:new Date(Date.now()+7200000).toISOString()}});
 expect(second.policy.version).toBe(2);
 const stored=(await pool.query("SELECT fleet_compliance_policies FROM partner_vendor_relationships WHERE partner_id=$1 AND vendor_id=$2",[f.partner,f.vendor])).rows[0].fleet_compliance_policies;
 expect(stored.policies).toHaveLength(2);expect(stored.policies[0]).toEqual(first.policy);
 expect(await service!.readFleetPolicy(actor,binding)).toMatchObject({version:2,policies:stored.policies});
 await pool.query("UPDATE user_org_memberships SET role='member' WHERE id=$1",[member.id]);
 await expect(service!.activateFleetPolicy(actor,binding,{...input,operationId:randomUUID(),expectedVersion:2})).rejects.toMatchObject({status:403});
});
