import {createHmac,timingSafeEqual} from 'node:crypto';
import {Router,type IRouter} from 'express';
import {isE164Phone} from '../lib/twilio';
import {acknowledgeStaffingSms} from '../services/gate-staffing-sms';
export type StaffingSmsReplyConfig={enabled:boolean;url:string;authToken:string;accountSid:string;messagingServiceSid:string};
export function staffingSmsReplyConfig(env:Record<string,string|undefined>=process.env):StaffingSmsReplyConfig{
 let url=env.TWILIO_STAFFING_INBOUND_URL?.trim()??'';
 if(!url&&env.TWILIO_STATUS_CALLBACK_URL){try{url=new URL('/api/twilio/staffing-alert-reply',env.TWILIO_STATUS_CALLBACK_URL).href;}catch{/* unconfigured */}}
 return {enabled:env.TWILIO_STAFFING_REPLY_ENABLED==='true',url,authToken:env.TWILIO_AUTH_TOKEN??'',accountSid:env.TWILIO_ACCOUNT_SID??'',messagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID??''};
}
export function createTwilioStaffingReplyRouter(deps:{config():StaffingSmsReplyConfig;acknowledge(input:{from:string;code:string;messageSid:string}):Promise<boolean>}):IRouter{
 const router=Router();
 router.post('/twilio/staffing-alert-reply',async(req,res)=>{
  const cfg=deps.config();let validUrl=false;
  try{const u=new URL(cfg.url);validUrl=u.protocol==='https:'&&u.pathname==='/api/twilio/staffing-alert-reply'&&!u.search&&!u.hash&&!u.username&&!u.password;}catch{/* fail closed */}
  if(!cfg.enabled||!validUrl||!cfg.authToken||!/^AC[a-f0-9]{32}$/i.test(cfg.accountSid)||!/^MG[a-f0-9]{32}$/i.test(cfg.messagingServiceSid))return res.sendStatus(503);
  const body=req.body as Record<string,unknown>;
  if(Object.keys(req.query).length||!req.is('application/x-www-form-urlencoded')||!body||Object.values(body).some(v=>typeof v!=='string'))return res.sendStatus(403);
  const expected=createHmac('sha1',cfg.authToken).update(cfg.url+Object.keys(body).sort().map(k=>k+body[k]).join('')).digest('base64');
  const signature=req.get('X-Twilio-Signature')??'';
  if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))||body.AccountSid!==cfg.accountSid||body.MessagingServiceSid!==cfg.messagingServiceSid)return res.sendStatus(403);
  const empty=()=>res.status(200).type('text/xml').send('<Response/>');
  // Twilio Advanced Opt-Out owns STOP/START/HELP. Never treat them as acknowledgment.
  if(body.OptOutType||typeof body.Body!=='string'||typeof body.From!=='string'||!isE164Phone(body.From)||typeof body.MessageSid!=='string'||!/^SM[a-f0-9]{32}$/i.test(body.MessageSid))return empty();
  const match=body.Body.trim().match(/^ACK\s+([A-F0-9]{10})$/i);
  if(!match)return empty();
  try{await deps.acknowledge({from:body.From,code:match[1].toUpperCase(),messageSid:body.MessageSid});return empty();}
  catch{return res.sendStatus(503);} // Provider may retry; the shared acknowledgment is idempotent.
 });
 return router;
}
export default createTwilioStaffingReplyRouter({config:()=>staffingSmsReplyConfig(),acknowledge:acknowledgeStaffingSms});
