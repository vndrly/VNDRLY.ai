import {randomUUID} from "node:crypto";
import {it,expect} from "vitest";
import {pool} from "@workspace/db";
import {createFleetPricingFixture} from "../test-utils/fleet-pricing";
import {saveFleetAgreement} from "./fleet-agreement";
it("saves exact partner approved terms with current authority and immutable retry",async()=>{
 const f=await createFleetPricingFixture();
 const member=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,partner_id,role) VALUES($1,'partner',$2,'admin') RETURNING id",[f.user,f.partner])).rows[0];
 await pool.query("UPDATE work_types SET partner_id=$1 WHERE id=$2",[f.partner,f.service]);
 const user=(await pool.query("SELECT session_version FROM users WHERE id=$1",[f.user])).rows[0];
 const actor={userId:f.user,sv:user.session_version,role:"partner",partnerId:f.partner,activeMembershipId:member.id};
 const input={operationId:randomUUID(),expectedApprovalRevision:"2026-10-01T00:00:00.000Z",terms:{basis:"per_barrel" as const,unitRate:"0.0125",effectiveFrom:"2026-10-01T00:00:00Z",effectiveUntil:null,minimum:{amount:"25",scope:"run" as const},detention:{ratePerHour:"90.125",freeMinutes:"30",incrementMinutes:"15",rounding:"away_from_zero" as const,allowHourlyOverlap:false},extras:[],notes:"Agreed exact commercial terms"}};
 const a=await saveFleetAgreement(actor,{partnerId:f.partner,vendorId:f.vendor,serviceId:f.service},input);
 expect(a.unitRate).toBe("0.0125");expect(a.minimum?.amount).toBe("25");expect(a.approvedByUserId).toBe(f.user);
 expect(await saveFleetAgreement(actor,{partnerId:f.partner,vendorId:f.vendor,serviceId:f.service},input)).toEqual(a);
 await expect(saveFleetAgreement(actor,{partnerId:f.partner,vendorId:f.vendor,serviceId:f.service},{...input,terms:{...input.terms,unitRate:"999"}})).rejects.toMatchObject({status:409});
 await expect(saveFleetAgreement({...actor,sv:actor.sv+1},{partnerId:f.partner,vendorId:f.vendor,serviceId:f.service},input)).rejects.toMatchObject({status:403});
 const row=(await pool.query("SELECT precise_unit_price,fleet_rate_card FROM partner_vendor_work_type_approvals WHERE vendor_id=$1 AND work_type_id=$2",[f.vendor,f.service])).rows[0];expect(row.precise_unit_price).toBe("0.012500000");expect(row.fleet_rate_card).toEqual(a);
});
