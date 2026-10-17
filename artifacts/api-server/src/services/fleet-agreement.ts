import {createHash,randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {SaveFleetAgreementSchema,FleetRateCardRevisionSchema} from "@workspace/api-zod";
import {FleetError} from "./fleet-repository";
import {formatExact,parseExactDecimal,roundExact} from "@workspace/db/format";
type Actor={userId?:number;sv?:number;role?:string;partnerId?:number|null;activeMembershipId?:number|null;publicDemo?:boolean;readOnly?:boolean};
/** Only an actual current partner administrator can approve financial terms.
 * Every revision is retained; an activity's earlier saved authority is untouched. */
export async function saveFleetAgreement(actor:Actor, binding:{partnerId:number;vendorId:number;serviceId:number},raw:unknown){
 const input=SaveFleetAgreementSchema.parse(raw),{partnerId,vendorId,serviceId}=binding;
 if(actor.publicDemo||actor.readOnly||actor.role!=="partner"||actor.partnerId!==partnerId)throw new FleetError("fleet.partner_approval_required",403);
 const c=await pool.connect();try{await c.query("BEGIN");
 const auth=await c.query("SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.user_id=$2 AND m.org_type='partner' AND m.partner_id=$3 AND m.role='admin' AND u.session_version=$4 AND u.suspended_at IS NULL FOR SHARE OF m,u",[actor.activeMembershipId,actor.userId,partnerId,actor.sv]);
 if(!auth.rows.length)throw new FleetError("fleet.current_session_required",403);
 const row=(await c.query("SELECT a.* FROM partner_vendor_work_type_approvals a JOIN work_types w ON w.id=a.work_type_id AND w.partner_id=a.partner_id JOIN partner_vendor_relationships r ON r.partner_id=a.partner_id AND r.vendor_id=a.vendor_id AND r.status='approved' WHERE a.partner_id=$1 AND a.vendor_id=$2 AND a.work_type_id=$3 FOR UPDATE OF a FOR SHARE OF w,r",[partnerId,vendorId,serviceId])).rows[0];
 if(!row)throw new FleetError("fleet.partner_approval_required",403);
 const fingerprint=createHash("sha256").update(JSON.stringify({binding,input})).digest("hex"),target=`agreement:${input.operationId}`;
 const prior=(await c.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-agreement' AND target_id=$2 ORDER BY id DESC LIMIT 1",[vendorId,target])).rows[0]?.tool_output;
 if(prior){if(prior.fingerprint!==fingerprint||prior.actorUserId!==actor.userId)throw new FleetError("fleet.operation_conflict");await c.query("COMMIT");return FleetRateCardRevisionSchema.parse(prior.card);}
 if(new Date(row.approved_at).toISOString()!==input.expectedApprovalRevision)throw new FleetError("fleet.approval_version_conflict");
 const now=new Date().toISOString(),prev=FleetRateCardRevisionSchema.safeParse(row.fleet_rate_card);
 const card=FleetRateCardRevisionSchema.parse({...input.terms,id:randomUUID(),version:prev.success?prev.data.version+1:1,vendorId,serviceId,partnerId,billingSiteId:null,approvalRef:{type:"partner_approval",id:String(row.id),revision:now},currency:"USD",currencyScale:2,currencyRounding:"half_away_from_zero",approvedByUserId:actor.userId,approvedAt:now});
 await c.query("UPDATE partner_vendor_work_type_approvals SET precise_unit_price=$1,approved_unit_price=$2,approved_unit=$3,approved_currency='USD',approved_at=$4,approved_by_user_id=$5,fleet_rate_card=$6::jsonb WHERE id=$7",[card.unitRate,formatExact(roundExact(parseExactDecimal(card.unitRate),{scale:2,rounding:"half_away_from_zero"})),card.basis,now,actor.userId,JSON.stringify(card),row.id]);
 await c.query("INSERT INTO assistant_action_audit(user_id,vendor_id,partner_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,'fleet','typed','canonical','fleet_agreement','approved','fleet-agreement',$4,$5::jsonb,'completed')",[actor.userId,vendorId,partnerId,target,JSON.stringify({fingerprint,actorUserId:actor.userId,card,previousApprovalRevision:input.expectedApprovalRevision})]);
 await c.query("COMMIT");return card;
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
