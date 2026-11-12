import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import type { SessionPayload } from "../lib/session";
import { buildTestCookie } from "../test-utils/session";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)("verified Gate helper proficiency receipts", () => {
  let pool: typeof import("@workspace/db")["pool"];
  let record: typeof import("./workflow-helper-progress")["recordWorkflowHelperCompletion"];
  let read: typeof import("./workflow-helper-progress")["readWorkflowHelperProgress"];
  let summary: typeof import("./account-next-steps")["readAccountNextSteps"];
  let movement: typeof import("./gate-topology")["recordGateMovement"];
  let app: Express;
  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    ({pool} = await import("@workspace/db"));
    const target = new URL(process.env.DATABASE_URL!);
    expect((await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0]).toEqual({database:process.env.VNDRLY_FRESH_TEST_DB_NAME,address:"127.0.0.1",port:Number(target.port)});
    ({recordWorkflowHelperCompletion:record,readWorkflowHelperProgress:read} = await import("./workflow-helper-progress"));
    ({readAccountNextSteps:summary} = await import("./account-next-steps"));
    ({recordGateMovement:movement} = await import("./gate-topology"));
    const {default:express}=await import("express"),{default:cookieParser}=await import("cookie-parser"),{default:router}=await import("../routes/workflowHelpers");
    app=express();app.use(express.json(),cookieParser());app.use("/api",router);
  });
  async function fixture() {
    const key=randomUUID();
    const vendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email,operations_categories) VALUES($1,'Synthetic','synthetic@example.invalid',ARRAY['gate']) RETURNING id",[key])).rows[0].id;
    const partner=(await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic','synthetic@example.invalid') RETURNING id",[key])).rows[0].id;
    const office=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'unusable-synthetic','vendor','Synthetic office') RETURNING id",[`office-${key}`])).rows[0].id;
    const worker=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'unusable-synthetic','field_employee','Synthetic keeper') RETURNING id",[`worker-${key}`])).rows[0].id;
    const person=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,last_name,email,phone,photo_url) VALUES($1,$2,'gatekeeper','Synthetic','Keeper','synthetic@example.invalid','5555555555','/synthetic.jpg') RETURNING id",[vendor,worker])).rows[0].id;
    const officeMembership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",[office,vendor])).rows[0].id;
    const workerMembership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'field_employee',$3) RETURNING id",[worker,vendor,person])).rows[0].id;
    await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1",[office,officeMembership]);
    await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1",[worker,workerMembership]);
    const site=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Synthetic',30,-100,$3) RETURNING id",[partner,key,randomUUID()])).rows[0].id;
    const existing=(await pool.query("SELECT id FROM gate_stations WHERE site_id=$1 ORDER BY created_at,id LIMIT 1",[site])).rows[0];
    const station=existing?.id??(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Synthetic entrance') RETURNING id",[site])).rows[0].id;
    const work=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",[key])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",[site,work,vendor]);
    await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",[partner,vendor]);
    await pool.query("INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)",[person,site]);
    const officeSession:SessionPayload={userId:office,role:"vendor",vendorId:vendor,activeMembershipId:officeMembership,membershipRole:"admin",sv:1};
    const workerSession:SessionPayload={userId:worker,role:"field_employee",vendorId:vendor,activeMembershipId:workerMembership,membershipRole:"field_employee",vendorRole:"gatekeeper",vendorPeopleId:person,sv:1};
    return {vendor,partner,office,worker,person,officeMembership,workerMembership,site,station,work,officeSession,workerSession};
  }
  async function savedShift(f:Awaited<ReturnType<typeof fixture>>,assigned=true) {
    const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic assigned watch',now()-interval '2 hours',now()+interval '6 hours','UTC',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,f.station])).rows[0].id;
    if(assigned)await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[shift,f.worker]);
    return shift;
  }
  async function savedWatch(f:Awaited<ReturnType<typeof fixture>>,withTicket=true) {
    const shift=await savedShift(f);
    const watch=(await pool.query("INSERT INTO gate_shifts(station_id,operator_id,ended_at) VALUES($1,$2,now()) RETURNING id",[f.station,f.worker])).rows[0].id;
    const ticket=withTicket?(await pool.query("INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status,field_employee_id,created_by_id) VALUES($1,$2,$3,'initiated',$4,$5) RETURNING id",[f.site,f.vendor,f.work,f.person,f.worker])).rows[0].id:null;
    const duty=(await pool.query("INSERT INTO gate_duty_sessions(station_id,user_id,work_hub_shift_id,source_legacy_shift_id,source,idempotency_key,post_coverage,ended_at) VALUES($1,$2,$3,$4,'web',$5,$6::jsonb,now()) RETURNING id",[f.station,f.worker,shift,watch,randomUUID(),JSON.stringify({vendorId:f.vendor,ticketId:ticket})])).rows[0].id;
    return {shift,watch,ticket,duty};
  }
  const completion=(f:Awaited<ReturnType<typeof fixture>>,watch:string,mode:"guided"|"independent"="independent")=>({workflowKey:"first-watch",mode,recordType:"gate-watch",recordId:watch,siteId:f.site});
  async function receiptCount(userId:number) {
    return (await pool.query("SELECT count(*)::int AS n FROM work_hub_client_operations WHERE user_id=$1 AND command_kind='workflow.helper.completed'",[userId])).rows[0].n;
  }
  it("records guided success without mastery and never upgrades that same saved watch on replay",async()=>{
    const f=await fixture(),{watch}=await savedWatch(f);
    expect(await record(f.officeSession,completion(f,watch,"guided"))).toMatchObject({recorded:true,counted:false,mode:"guided",helperProgress:{independentThreshold:3,independentCompletions:{"first-watch":0}}});
    expect(await record(f.officeSession,completion(f,watch,"independent"))).toMatchObject({recorded:true,counted:false,mode:"guided",helperProgress:{independentCompletions:{"first-watch":0}}});
    expect(await receiptCount(f.office)).toBe(1);
    expect((await read(f.officeSession)).independentCompletions["first-watch"]).toBe(0);
  });
  it("counts three independently completed distinct watches and deduplicates concurrent saves and replays",async()=>{
    const f=await fixture(),first=await savedWatch(f);
    const receipts=await Promise.all([record(f.officeSession,completion(f,first.watch)),record(f.officeSession,completion(f,first.watch.toUpperCase())),record(f.officeSession,completion(f,first.watch))]);
    expect(receipts.every(result=>result.mode==="independent"&&result.helperProgress.independentCompletions["first-watch"]===1)).toBe(true);
    const second=await savedWatch(f),third=await savedWatch(f);
    await record(f.officeSession,completion(f,second.watch));await record(f.officeSession,completion(f,third.watch));
    expect(await receiptCount(f.office)).toBe(3);
    expect((await summary(f.officeSession)).helperProgress).toMatchObject({independentThreshold:3,independentCompletions:{"first-watch":3,"gate-map-and-log":0}});
    expect((await summary(f.workerSession)).helperProgress.independentCompletions["first-watch"]).toBe(0);
    expect(await record(f.workerSession,completion(f,first.watch))).toMatchObject({counted:true,helperProgress:{independentCompletions:{"first-watch":1}}});
    expect((await read(f.officeSession)).independentCompletions["first-watch"]).toBe(3);
  });
  it("rejects employee setup, unconfirmed watches, mismatched tickets, sites and companies",async()=>{
    const f=await fixture(),other=await fixture(),pending=await savedWatch(f,false),foreign=await savedWatch(other);
    await expect(record(f.officeSession,{...completion(f,pending.watch),recordType:"vendor-person",recordId:f.person})).rejects.toMatchObject({status:400});
    await expect(record(f.officeSession,completion(f,pending.watch))).rejects.toMatchObject({status:409});
    await pool.query("UPDATE gate_duty_sessions SET post_coverage=$2::jsonb WHERE id=$1",[pending.duty,JSON.stringify({vendorId:f.vendor,ticketId:foreign.ticket})]);
    await expect(record(f.officeSession,completion(f,pending.watch))).rejects.toMatchObject({status:409});
    await expect(record(f.officeSession,{...completion(f,foreign.watch),siteId:other.site})).rejects.toMatchObject({status:403});
    await expect(record(f.officeSession,{...completion(f,pending.watch),siteId:other.site})).rejects.toMatchObject({status:403});
    expect(await receiptCount(f.office)).toBe(0);
  });
  it("keeps company proficiency separate and rejects a stale active-company session",async()=>{
    const f=await fixture(),other=await fixture(),a=await savedWatch(f),b=await savedWatch(other);
    await record(f.officeSession,completion(f,a.watch));
    const membership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",[f.office,other.vendor])).rows[0].id;
    const otherSession={...f.officeSession,vendorId:other.vendor,activeMembershipId:membership};
    await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1",[f.office,membership]);
    await expect(record(f.officeSession,completion(f,a.watch))).rejects.toMatchObject({status:403});
    expect((await summary(otherSession)).helperProgress.independentCompletions["first-watch"]).toBe(0);
    await record(otherSession,completion(other,b.watch));
    expect((await summary(otherSession)).helperProgress.independentCompletions["first-watch"]).toBe(1);
    await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1",[f.office,f.officeMembership]);
    expect((await summary(f.officeSession)).helperProgress.independentCompletions["first-watch"]).toBe(1);
  });
  it.each(["old session version","suspended account","removed membership","demo realm","public demo"])("denies %s without recording progress",async(reason)=>{
    const f=await fixture(),{watch}=await savedWatch(f);
    let session=f.officeSession;
    if(reason==="old session version")session={...session,sv:2};
    if(reason==="suspended account")await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1",[f.office]);
    if(reason==="removed membership")await pool.query("DELETE FROM user_org_memberships WHERE id=$1 AND user_id=$2",[f.officeMembership,f.office]);
    if(reason==="demo realm")session={...session,realm:"demo"};
    if(reason==="public demo")session={...session,publicDemo:true};
    await expect(record(session,completion(f,watch))).rejects.toMatchObject({status:403});
    expect(await receiptCount(f.office)).toBe(0);
  });
  it("requires a real completed handover, not its preparation or an ordinary watch",async()=>{
    const f=await fixture(),incoming=await savedWatch(f),outgoing=await savedWatch(f);
    const request={...completion(f,incoming.watch),workflowKey:"gate-watch-handoff"};
    await expect(record(f.workerSession,request)).rejects.toMatchObject({status:409});
    const preparation=(await pool.query("INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,'{}'::jsonb,'Synthetic','{}'::jsonb) RETURNING id",[outgoing.watch,f.worker])).rows[0].id;
    await expect(record(f.workerSession,request)).rejects.toMatchObject({status:409});
    await pool.query("INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name) VALUES($1,$2,$3,$4,'Synthetic outgoing','Synthetic incoming')",[randomUUID(),preparation,incoming.watch,f.worker]);
    expect(await record(f.workerSession,request)).toMatchObject({counted:true,helperProgress:{independentCompletions:{"gate-watch-handoff":1,"first-watch":0}}});
  });
  it("counts a saved staffed Gate schedule only after an assignee is persisted",async()=>{
    const f=await fixture(),shift=await savedShift(f,false);
    const request={workflowKey:"gate-shift-scheduling",mode:"independent",recordType:"gate-scheduled-shift",recordId:shift,siteId:f.site};
    await expect(record(f.officeSession,request)).rejects.toMatchObject({status:409});
    await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[shift,f.worker]);
    await expect(record(f.workerSession,request)).rejects.toMatchObject({status:403});
    expect(await record(f.officeSession,request)).toMatchObject({counted:true,helperProgress:{independentCompletions:{"gate-shift-scheduling":1}}});
    await pool.query("UPDATE work_hub_shifts SET milestone_status='cancelled' WHERE id=$1",[shift]);
    await expect(record(f.officeSession,request)).rejects.toMatchObject({status:409});
  });
  it("counts saved arrival after inner departure and rejects return intent alone",async()=>{
    const f=await fixture();
    const inner=(await pool.query("INSERT INTO gate_stations(site_id,name,topology) VALUES($1,'Synthetic inner',$2::jsonb) RETURNING id",[f.site,JSON.stringify({kind:"series",area:"Synthetic secure area",parentGateId:f.station,parallelGateId:null})])).rows[0].id;
    const initial={operationId:randomUUID(),kind:"enter",gateId:f.station,gateName:"Synthetic entrance",area:"",destinationGateId:inner,destination:"Synthetic inner",at:new Date().toISOString(),actorId:f.worker};
    const visit=(await pool.query("INSERT INTO site_visits(site_location_id,gate_station_id,first_name,last_name,host_type,host_partner_id,admission_status,gate_movements) VALUES($1,$2,'Synthetic','Visitor','partner',$3,'admitted',$4::jsonb) RETURNING id",[f.site,f.station,f.partner,JSON.stringify([initial])])).rows[0].id;
    const request=(workflowKey:string)=>({workflowKey,mode:"independent",recordType:"gate-visit",recordId:visit,siteId:f.site});
    expect(await record(f.workerSession,request("gate-vehicle-check-in"))).toMatchObject({counted:true});
    await expect(record(f.workerSession,request("gate-inner-arrival"))).rejects.toMatchObject({status:409});
    await pool.query("UPDATE gate_shifts SET ended_at=now() WHERE operator_id=$1 AND ended_at IS NULL",[f.worker]);
    await pool.query("INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2)",[inner,f.worker]);
    await movement(f.workerSession,{siteId:f.site,gateId:inner,visitId:visit,operationId:randomUUID(),kind:"enter"});
    expect(await record(f.workerSession,request("gate-inner-arrival"))).toMatchObject({counted:true});
    await movement(f.workerSession,{siteId:f.site,gateId:inner,visitId:visit,operationId:randomUUID(),kind:"leave",destination:"remain"});
    await expect(record(f.workerSession,request("gate-return-to-inner"))).rejects.toMatchObject({status:409});
    await pool.query("UPDATE gate_shifts SET station_id=$1 WHERE operator_id=$2 AND ended_at IS NULL",[f.station,f.worker]);
    await movement(f.workerSession,{siteId:f.site,gateId:f.station,visitId:visit,operationId:randomUUID(),kind:"route",destinationGateId:inner});
    await expect(record(f.workerSession,request("gate-return-to-inner"))).rejects.toMatchObject({status:409});
    await pool.query("UPDATE gate_shifts SET station_id=$1 WHERE operator_id=$2 AND ended_at IS NULL",[inner,f.worker]);
    await movement(f.workerSession,{siteId:f.site,gateId:inner,visitId:visit,operationId:randomUUID(),kind:"enter"});
    expect(await record(f.workerSession,request("gate-return-to-inner"))).toMatchObject({counted:true});
    await expect(record(f.workerSession,request("gate-vehicle-check-out"))).rejects.toMatchObject({status:409});
    const exit={...initial,operationId:randomUUID(),kind:"site_exit",destinationGateId:null,destination:"remain"};
    await pool.query("UPDATE site_visits SET check_out_time=now(),gate_movements=gate_movements||$2::jsonb WHERE id=$1",[visit,JSON.stringify([exit])]);
    expect(await record(f.workerSession,request("gate-vehicle-check-out"))).toMatchObject({counted:true});
    await expect(record(f.workerSession,request("gate-early-turnaround"))).rejects.toMatchObject({status:409});
    expect(await receiptCount(f.worker)).toBe(4);
    await record(f.workerSession,{...request("gate-inner-arrival"),recordId:String(visit)});
    expect(await receiptCount(f.worker)).toBe(4);
  });
  it("requires the actual saved early-turnaround departure before counting it",async()=>{
    const f=await fixture(),inner=randomUUID();
    const entry={operationId:randomUUID(),kind:"enter",gateId:f.station,gateName:"Synthetic entrance",area:"",destinationGateId:inner,destination:"Synthetic inner",at:new Date().toISOString(),actorId:f.worker};
    const visit=(await pool.query("INSERT INTO site_visits(site_location_id,gate_station_id,first_name,last_name,host_type,host_partner_id,admission_status,gate_movements) VALUES($1,$2,'Synthetic','Visitor','partner',$3,'admitted',$4::jsonb) RETURNING id",[f.site,f.station,f.partner,JSON.stringify([entry])])).rows[0].id;
    const request={workflowKey:"gate-early-turnaround",mode:"independent",recordType:"gate-visit",recordId:visit,siteId:f.site};
    await expect(record(f.officeSession,request)).rejects.toMatchObject({status:409});
    const exit={...entry,operationId:randomUUID(),kind:"site_exit",destinationGateId:null,destination:"remain",note:"Exited before inner arrival"};
    await pool.query("UPDATE site_visits SET check_out_time=now(),gate_movements=gate_movements||$2::jsonb WHERE id=$1",[visit,JSON.stringify([exit])]);
    expect(await record(f.officeSession,request)).toMatchObject({counted:true,helperProgress:{independentCompletions:{"gate-early-turnaround":1}}});
  });
  it("rejects navigation, unsupported helpers and mismatched proof types",async()=>{
    const f=await fixture(),{watch}=await savedWatch(f);
    for(const body of [{workflowKey:"first-watch",mode:"independent"},{...completion(f,watch),workflowKey:"profile"},{...completion(f,watch),workflowKey:"gate-map-and-log"},{...completion(f,watch),workflowKey:"gate-inner-arrival"},{...completion(f,watch),mode:"opened"}])await expect(record(f.officeSession,body)).rejects.toMatchObject({status:400});
    expect(await receiptCount(f.office)).toBe(0);
  });
  it("requires a signed session and preserves the mounted actor/company headers",async()=>{
    const {default:request}=await import("supertest");
    const f=await fixture(),{watch}=await savedWatch(f),path="/api/workflow-helpers/completions";
    expect((await request(app).post(path).send(completion(f,watch))).status).toBe(401);
    expect((await request(app).post(path).set("Cookie",buildTestCookie(f.officeSession,{exp:1})).send(completion(f,watch))).status).toBe(401);
    expect((await request(app).post(path).set("Cookie",buildTestCookie(f.officeSession)).set("X-VNDRLY-Actor-User",String(f.office)).set("X-VNDRLY-Vendor",String(f.vendor+100000)).set("X-VNDRLY-Membership",String(f.officeMembership)).send(completion(f,watch))).status).toBe(409);
    const response=await request(app).post(path).set("Cookie",buildTestCookie(f.officeSession)).set("X-VNDRLY-Actor-User",String(f.office)).set("X-VNDRLY-Vendor",String(f.vendor)).set("X-VNDRLY-Membership",String(f.officeMembership)).send(completion(f,watch));
    expect(response.status).toBe(200);expect(response.headers["cache-control"]).toContain("no-store");expect(response.body).toMatchObject({counted:true,helperProgress:{independentThreshold:3,independentCompletions:{"first-watch":1}}});
  });
});
