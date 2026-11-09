import assert from "node:assert/strict";
import test from "node:test";
import { inspectStaffingInbound, STAFFING_INBOUND_URL } from "../provision-twilio-staffing-inbound.mjs";

const account = "AC"+"1".repeat(32), serviceId = "MG"+"2".repeat(32), phoneId = "PN"+"3".repeat(32);
const env = { TWILIO_ACCOUNT_SID: account, TWILIO_API_KEY: "SK"+"4".repeat(32), TWILIO_API_SECRET: "synthetic-api-secret", TWILIO_AUTH_TOKEN: "synthetic-auth-token", TWILIO_MESSAGING_SERVICE_SID: serviceId, TWILIO_ADVANCED_OPT_OUT_ENABLED: "true" };
function fixture({service = {}, number = {}, failUpdate = false, tokenInvalid = false} = {}) {
  let settings = {sid:serviceId,account_sid:account,inbound_request_url:null,inbound_method:"POST",fallback_url:null,fallback_method:"POST",status_callback:"https://vndrly.ai/api/twilio/gate-alert-status",use_inbound_webhook_on_number:false,...service};
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url,method:options.method,body:options.body?.toString()});
    assert.equal(url.includes("/Messages"),false,"never send a message");
    if (url.includes("/IncomingPhoneNumbers/")) return Response.json({sid:phoneId,account_sid:account,capabilities:{sms:true},sms_url:null,sms_fallback_url:null,sms_application_sid:null,...number});
    if (url.endsWith(`/Accounts/${account}.json`)) return tokenInvalid ? Response.json({code:20003,message:"do not print credentials"},{status:401}) : Response.json({sid:account,status:"active",auth_token:"never-serialize-this"});
    if (url.includes("/PhoneNumbers?")) return Response.json({phone_numbers:[{sid:phoneId,account_sid:account}],meta:{next_page_url:null}});
    if (url.includes("/ShortCodes?")) return Response.json({short_codes:[],meta:{next_page_url:null}});
    if (options.method === "POST") {
      if (failUpdate) return Response.json({code:20003},{status:403});
      assert.deepEqual(Object.fromEntries(options.body),{InboundRequestUrl:STAFFING_INBOUND_URL,InboundMethod:"POST",UseInboundWebhookOnNumber:"false"});
      settings={...settings,inbound_request_url:STAFFING_INBOUND_URL,inbound_method:"POST",use_inbound_webhook_on_number:false};
    }
    return Response.json(settings);
  };
  return {fetchImpl,requests,settings:()=>settings};
}
test("default inspection reports unconfigured inbound without any mutations or secret output",async()=>{
  const f=fixture(),result=await inspectStaffingInbound(env,f);
  assert.equal(result.readyToEnable,false);assert.deepEqual(result.blockers,["inbound_not_configured"]);assert.equal(f.requests.some(r=>r.method!=="GET"),false);
  assert.equal(/synthetic-|never-serialize|auth_token|phone_number/.test(JSON.stringify(result)),false);
});
test("configure changes only empty owned service routing, verifies it and is idempotent",async()=>{
  const f=fixture(),result=await inspectStaffingInbound(env,{...f,configure:true});
  assert.equal(result.readyToEnable,true);assert.equal(result.configured,true);assert.equal(f.requests.filter(r=>r.method==="POST").length,1);
  assert.equal(f.settings().status_callback,"https://vndrly.ai/api/twilio/gate-alert-status");
  const replay=await inspectStaffingInbound(env,{...f,configure:true});assert.equal(replay.readyToEnable,true);assert.equal(replay.configured,false);assert.equal(f.requests.filter(r=>r.method==="POST").length,1);
});
for(const [label,options] of [["service inbound",{service:{inbound_request_url:"https://existing.example.invalid/incoming?secret=never"}}],["fallback",{service:{fallback_url:"https://existing.example.invalid/fallback"}}],["number webhook",{number:{sms_url:"https://existing.example.invalid/inbound"}}],["TwiML app",{number:{sms_application_sid:"AP"+"5".repeat(32)}}]])test(`preserves existing ${label} without provider mutation`,async()=>{
  const f=fixture(options),result=await inspectStaffingInbound(env,{...f,configure:true});assert.equal(result.readyToEnable,false);assert.equal(f.requests.some(r=>r.method==="POST"),false);assert.equal(JSON.stringify(result).includes("existing.example"),false);
});
test("missing signature token, unverified token, missing STOP attestation and explicit disable block configuration",async()=>{
  for(const changes of [{TWILIO_AUTH_TOKEN:""},{TWILIO_ADVANCED_OPT_OUT_ENABLED:"false"},{TWILIO_STAFFING_REPLY_ENABLED:"false"}]){const f=fixture();assert.equal((await inspectStaffingInbound({...env,...changes},{...f,configure:true})).readyToEnable,false);assert.equal(f.requests.some(r=>r.method==="POST"),false);}
  const f=fixture({tokenInvalid:true}),result=await inspectStaffingInbound(env,{...f,configure:true});assert.equal(result.readyToEnable,false);assert.ok(result.blockers.includes("webhook_auth_token_not_verified"));assert.equal(f.requests.some(r=>r.method==="POST"),false);
});
test("provider rejection remains blocked and does not claim successful configuration",async()=>{
  const f=fixture({failUpdate:true}),result=await inspectStaffingInbound(env,{...f,configure:true});assert.equal(result.readyToEnable,false);assert.equal(result.configured,false);assert.ok(result.blockers.includes("provider_http_403_code_20003"));
});
test("a routing change during inspection blocks the configure write",async()=>{
  const f=fixture();let reads=0;
  const fetchImpl=async(url,options)=>{
    if(url===`https://messaging.twilio.com/v1/Services/${serviceId}`&&options.method==="GET"&&++reads===2)return Response.json({...f.settings(),inbound_request_url:"https://existing.example.invalid/changed"});
    return f.fetchImpl(url,options);
  };
  const result=await inspectStaffingInbound(env,{configure:true,fetchImpl});
  assert.equal(result.readyToEnable,false);assert.ok(result.blockers.includes("provider_settings_changed_during_inspection"));assert.equal(f.requests.some(r=>r.method==="POST"),false);
});
