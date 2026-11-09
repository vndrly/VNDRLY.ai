import {pool} from '@workspace/db';
import type {SessionPayload} from '../lib/session';
import {isE164Phone} from '../lib/twilio';
import {smsConsentFingerprint} from './gate-alert-delivery';
import {notificationCompanyHoldApplies} from '../lib/notification-company-hold';
import {listGateStaffingAlerts,acknowledgeGateStaffingAlert} from './gate-staffing-alerts';

type SmsAdminClient={query(sql:string,args:unknown[]):Promise<{rows:any[]}>};
/** The provider-authenticated sender is still not authority without fresh company/admin consent. */
export async function resolveStaffingSmsAdmin(phone:string,client:SmsAdminClient=pool,lock=false):Promise<SessionPayload|null>{
 if(!isE164Phone(phone))return null;
 const {rows}=await client.query(`SELECT u.id AS user_id,u.session_version,u.display_name,m.id AS membership_id,m.vendor_id,m.vendor_people_id,
   p.alerts_sms_consent_fingerprint,p.alerts_sms_opted_in_at,vp.phone,vp.vendor_role
   FROM users u JOIN user_org_memberships m ON m.id=u.active_membership_id AND m.user_id=u.id
   JOIN vendor_people vp ON vp.id=m.vendor_people_id AND vp.vendor_id=m.vendor_id AND vp.user_id=u.id
   JOIN notification_preferences p ON p.user_id=u.id
   WHERE u.suspended_at IS NULL AND u.must_change_password=false AND m.org_type='vendor' AND m.role='admin'
     AND m.partner_id IS NULL AND vp.deleted_at IS NULL AND vp.is_active=true AND vp.phone=$1
     AND p.alerts_sms_enabled=true AND p.alerts_sms_opted_in_at IS NOT NULL${lock?' FOR SHARE OF u,m,vp,p':''}`,[phone]);
 // Shared phone numbers never guess which person acknowledged responsibility.
 if(rows.length!==1)return null;
 const r=rows[0];
 if(r.alerts_sms_consent_fingerprint!==smsConsentFingerprint(r.user_id,r.membership_id,r.vendor_people_id,phone))return null;
 return {userId:r.user_id,role:'vendor',vendorId:r.vendor_id,partnerId:null,vendorPeopleId:r.vendor_people_id,vendorRole:r.vendor_role,
   activeMembershipId:r.membership_id,membershipRole:'admin',sv:r.session_version,displayName:r.display_name,realm:'production',publicDemo:false};
}
export async function acknowledgeStaffingSms(input:{from:string;code:string;messageSid:string}):Promise<boolean>{
 const session=await resolveStaffingSmsAdmin(input.from);
 if(!session?.userId||await notificationCompanyHoldApplies(session.userId))return false;
 const alerts=await listGateStaffingAlerts(session);
 const alert=alerts.alerts.find(item=>item.code===input.code);
 if(!alert||!alert.canAcknowledge||alert.notificationsPaused)return false;
 await acknowledgeGateStaffingAlert(session,alert.id,'sms',async client=>{
  const fresh=await resolveStaffingSmsAdmin(input.from,client,true);
  if(!fresh||fresh.userId!==session.userId||fresh.activeMembershipId!==session.activeMembershipId||fresh.vendorId!==session.vendorId||fresh.sv!==session.sv)throw Object.assign(new Error('SMS authority changed'),{status:403});
 });
 return true;
}
