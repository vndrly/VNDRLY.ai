import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ writes: [] as any[], audit: [] as any[], recipient: null as any, user: {} as any, consent:null as any }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  const tx: any = {
    select: () => ({ from: (table:any) => ({ where: () => Object.assign(Promise.resolve(table===schema.notificationPreferencesTable?[{consent:state.consent}]:[state.user]),{for:async()=>[state.user],orderBy:async()=>state.audit.filter(a=>a.subjectType==='personal_agreement').reverse().map(a=>({metadata:a.metadata}))}) }) }),
    update:()=>({set:(values:any)=>({where:async()=>{state.writes.push(values);state.consent=null;}})}),
    insert: (table: any) => ({ values: (values: any) => {
      if (table === schema.workHubAuditLogTable) { state.audit.push(...(Array.isArray(values)?values:[values])); return Promise.resolve(); }
      return { onConflictDoUpdate: () => { state.writes.push(values); return Promise.resolve(); } };
    } }),
  };
  return { ...schema, db: { ...tx, transaction: async (fn: any) => fn(tx) } };
});
vi.mock("../services/gate-alert-repository", () => ({ loadSmsConsentRecipient: async () => state.recipient }));
import router from "./smsConsent";
const app = express(); app.use(express.json(), express.urlencoded({ extended: false }), cookieParser(), router);
const cookie = () => buildTestCookie({ userId: 7, role: "field_employee", vendorId: 3, vendorRole: "gatekeeper", activeMembershipId: 8, sv: 1 });
const form = { phone: "+14055551212", consent: "yes", policyVersion: "2026-08-24" };
beforeEach(() => {
  state.writes = []; state.audit = []; state.consent=null;
  state.user = { id: 7, sessionVersion: 1, activeMembershipId: 8, suspendedAt: null };
  state.recipient = { userId: 7, gate: true, membershipId: 8, vendorPeopleId: 9, phone: "+14055551212", session: { sv: 1, vendorId: 3 } };
});
describe("public SMS enrollment save", () => {
  it('changes the enrolled work number and records both consents atomically without sending a message',async()=>{
    const response=await request(app).post('/notifications/sms-consent').set('Origin','https://vndrly.ai').set('Cookie',cookie()).send({...form,phone:'4055559876',workPhone:true,workPhoneVersion:'2026-11-19'});
    expect(response.status).toBe(200);
    expect(state.writes[0].smsConsentRecord).toMatchObject({phone:'+14055559876',workPhone:true,workPhoneVersion:'2026-11-19'});
    expect(state.writes[0].smsConsentRecord.disclosure).toContain('Unsubscribe ends both');
    expect(state.audit.map(a=>a.action)).toEqual(['sms_consent_granted','personal_agreement_accepted']);
    expect(state.audit[1].metadata).toMatchObject({document:'work_phone',version:'2026-11-19'});
    expect(response.body.messageSent).toBe(false);
  });
  it('unsubscribes both choices and retains withdrawal audit evidence',async()=>{
    const response=await request(app).post('/notifications/sms-consent').set('Origin','https://vndrly.ai').set('Cookie',cookie()).send({consent:'no',workPhone:true});
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({smsConsentRecord:null,alertsSmsEnabled:false});
    expect(state.audit.map(a=>a.action)).toEqual(['sms_consent_withdrawn','personal_agreement_withdrawn']);
  });
  it('returns the enrolled number to its authenticated owner',async()=>{
    state.consent={phone:'+14055551212',workPhone:true};
    const response=await request(app).get('/personal-agreements').set('Cookie',cookie());
    expect(response.body).toMatchObject({smsPhone:'+14055551212',smsEnrolled:true,workPhoneEnrolled:true});
    expect((await request(app).get('/personal-agreements')).status).toBe(401);
  });
  it('does not allow withdrawing accepted platform agreements or changing Work Phone separately',async()=>{
    const response=await request(app).post('/personal-agreements').set('Cookie',cookie()).send({document:'privacy',version:'2026-08-24',accepted:false});
    expect(response.status).toBe(409);expect(state.audit).toHaveLength(0);
    expect((await request(app).post('/personal-agreements').set('Cookie',cookie()).send({document:'work_phone',version:'2026-11-19',accepted:true})).status).toBe(409);
  });
  it.each(["4055551212", "(405) 555-1212", "405.555.1212", "1-405-555-1212", "+1 (405) 555-1212"])("enrolls a domestic number without requiring a country code: %s", async phone => {
    state.recipient.phone = "(405) 555-1212";
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, phone });
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ alertsSmsEnabled: true, smsConsentRecord: { phone: "+14055551212" } });
    expect(response.body.messageSent).toBe(false);
  });
  it("requires a signed-in account and a same-origin submission", async () => {
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").send(form)).status).toBe(401);
    expect((await request(app).post("/notifications/sms-consent").set("Cookie", cookie()).set("Origin", "https://other.example").send(form)).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it.each([{ language: "fr" }, { consent: undefined }, { policyVersion: "old" }, { phone: "not-a-number" }, { phone: "+14055559999" }])("does not save invalid or mismatched consent: %j", async delta => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, ...delta });
    expect(response.status).toBe(400); expect(state.writes).toHaveLength(0);
  });
  it("records the exact disclosure and server time against the caller and enables only their bound Gate consent", async () => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, userId: 99, consentedAt: "2000-01-01" });
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ userId: 7, alertsSmsEnabled: true, smsConsentRecord: { phone: form.phone, source: "https://vndrly.ai/sms/", policyVersion: form.policyVersion } });
    expect(state.writes[0].smsConsentRecord.disclosure).toContain("Reply STOP");
    expect(state.writes[0].alertsSmsConsentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.audit[0]).toMatchObject({ actorUserId: 7, action: "sms_consent_granted" });
    expect(JSON.stringify(state.audit)).not.toContain(form.phone);
    expect(response.body).toMatchObject({ saved: true, gateAlertsEnabled: true, messageSent: false });
  });
  it("retains the exact Spanish consent and source without sending SMS", async () => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, language: "es" });
    expect(response.status).toBe(200);
    expect(state.writes[0].smsConsentRecord).toMatchObject({ language: "es", source: "https://vndrly.ai/es/sms/" });
    const { PUBLIC_SMS_CONSENT_DISCLOSURE_ES } = await import("@workspace/api-zod/legal-policy");
    expect(state.writes[0].smsConsentRecord.disclosure).toBe(PUBLIC_SMS_CONSENT_DISCLOSURE_ES);
    expect(state.audit[0].metadata.disclosure).toBe(PUBLIC_SMS_CONSENT_DISCLOSURE_ES);
    expect(response.body.messageSent).toBe(false);
  });
  it("saves an office user's consent without inventing Gate privileges or sending a message", async () => {
    state.recipient.gate = false;
    const office = buildTestCookie({ userId: 7, role: "vendor", vendorId: 3, activeMembershipId: 8, sv: 1 });
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", office).send(form);
    expect(response.status).toBe(200); expect(state.writes[0]).not.toHaveProperty("alertsSmsEnabled");
    expect(response.body.gateAlertsEnabled).toBe(false);
  });
  it("fails closed if the live membership changed", async () => {
    state.recipient.membershipId = 10;
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send(form)).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it.each([{ sessionVersion: 2 }, { activeMembershipId: 10 }, { suspendedAt: new Date() }])("rejects an account revoked between lookup and save: %j", async delta => {
    Object.assign(state.user, delta);
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send(form)).status).toBe(409);
    expect(state.writes).toHaveLength(0); expect(state.audit).toHaveLength(0);
  });
});
