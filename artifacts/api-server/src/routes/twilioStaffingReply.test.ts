import {createHmac} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {describe,it,expect,vi} from 'vitest';
vi.mock('../services/gate-staffing-sms',()=>({acknowledgeStaffingSms:vi.fn()}));
import {createTwilioStaffingReplyRouter,staffingSmsReplyConfig,type StaffingSmsReplyConfig} from './twilioStaffingReply';
import {PUBLIC_UNAUTHENTICATED_ALLOWLIST} from '../lib/publicApiAllowlist';
const cfg:StaffingSmsReplyConfig={enabled:true,url:'https://vndrly.ai/api/twilio/staffing-alert-reply',authToken:'test-token',accountSid:'AC'+'1'.repeat(32),messagingServiceSid:'MG'+'2'.repeat(32)};
const body={AccountSid:cfg.accountSid,MessagingServiceSid:cfg.messagingServiceSid,From:'+14055551212',To:'+14055550000',Body:'ACK A123B456C7',MessageSid:'SM'+'3'.repeat(32)};
const signature=(b:Record<string,string>,url=cfg.url)=>createHmac('sha1',cfg.authToken).update(url+Object.keys(b).sort().map(k=>k+b[k]).join('')).digest('base64');
function fixture(config=cfg){const acknowledge=vi.fn(async()=>true);const app=express();app.use(express.urlencoded({extended:false}));app.use('/api',createTwilioStaffingReplyRouter({config:()=>config,acknowledge}));return{app,acknowledge};}
function send(f:ReturnType<typeof fixture>,b=body){return request(f.app).post('/api/twilio/staffing-alert-reply').type('form').set('X-Twilio-Signature',signature(b)).send(b);}
describe('staffing SMS replies require exact provider and current-admin resolution',()=>{
 it('allowlists only the exact POST callback',()=>{for(const [method,path,allowed]of[['POST','/api/twilio/staffing-alert-reply',true],['GET','/api/twilio/staffing-alert-reply',false],['POST','/api/twilio/staffing-alert-reply/other',false]]as const)expect(PUBLIC_UNAUTHENTICATED_ALLOWLIST.some(r=>r.method===method&&r.pattern.test(path))).toBe(allowed);});
 it('accepts signed exact ACK code independent of internal proxy host, without sending a reply',async()=>{const f=fixture();const r=await send(f).set('Host','internal:8080');expect(r.status).toBe(200);expect(r.text).toBe('<Response/>');expect(f.acknowledge).toHaveBeenCalledWith({from:body.From,code:'A123B456C7',messageSid:body.MessageSid});});
 it('rejects missing signature, body tampering, query injection and another account/service',async()=>{
  const f=fixture();expect((await request(f.app).post('/api/twilio/staffing-alert-reply').type('form').send(body)).status).toBe(403);
  expect((await request(f.app).post('/api/twilio/staffing-alert-reply').type('form').set('X-Twilio-Signature',signature(body)).send({...body,Body:'ACK 0000000000'})).status).toBe(403);
  expect((await request(f.app).post('/api/twilio/staffing-alert-reply?code=A123B456C7').type('form').set('X-Twilio-Signature',signature(body)).send(body)).status).toBe(403);
  expect((await send(f,{...body,AccountSid:'AC'+'4'.repeat(32)})).status).toBe(403);expect((await send(f,{...body,MessagingServiceSid:'MG'+'5'.repeat(32)})).status).toBe(403);expect(f.acknowledge).not.toHaveBeenCalled();
 });
 it.each(['ACK','YES','STOP','START','HELP','ACK A123B456C7 extra','ACK A123B456C8\nACK 0000000000'])('does not interpret %s as an alert acknowledgment',async Body=>{const f=fixture();expect((await send(f,{...body,Body})).status).toBe(200);expect(f.acknowledge).not.toHaveBeenCalled();});
 it('normalizes case but keeps exact alert code; opt-out metadata never acknowledges',async()=>{const f=fixture();await send(f,{...body,Body:' ack a123b456c7 '});expect(f.acknowledge).toHaveBeenCalledOnce();f.acknowledge.mockClear();await send(f,{...body,OptOutType:'STOP'}as typeof body);expect(f.acknowledge).not.toHaveBeenCalled();});
 it('never claims success when persistence fails and permits an idempotent provider retry',async()=>{const f=fixture();f.acknowledge.mockRejectedValueOnce(Error('storage unavailable'));expect((await send(f)).status).toBe(503);expect((await send(f)).status).toBe(200);expect(f.acknowledge).toHaveBeenCalledTimes(2);});
 it('gates inbound handling until provider wiring is deliberately enabled',async()=>{const f=fixture({...cfg,enabled:false});expect((await send(f)).status).toBe(503);expect(f.acknowledge).not.toHaveBeenCalled();expect(staffingSmsReplyConfig({TWILIO_STATUS_CALLBACK_URL:'https://vndrly.ai/api/twilio/gate-alert-status'})).toMatchObject({enabled:false,url:cfg.url});});
});
