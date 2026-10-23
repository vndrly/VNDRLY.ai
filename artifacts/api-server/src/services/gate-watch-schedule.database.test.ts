import {beforeAll,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {readFile} from "node:fs/promises";
import type {SessionPayload} from "../lib/session";
vi.mock('./gate-alert-repository',()=>({processPendingGateAlert:vi.fn()}));
vi.mock('../lib/notification-events',()=>({publishNotificationCreated:vi.fn()}));
import {listMyScheduledWatches,respondToScheduledWatch} from './gate-watch-schedule';
beforeAll(async()=>{
  if(process.env.VNDRLY_TEST_DB_MODE!=='fresh-local')throw Error('Requires an isolated fresh local database');
  await pool.query(await readFile(new URL('../../../../lib/db/drizzle/gate_change_over.sql',import.meta.url),'utf8'));
});
async function fixture(hours=12){
  const key=randomUUID();
  const partner=(await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",[key])).rows[0].id;
  const vendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",[key])).rows[0].id;
  const site=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Schedule test gate','Test',30,-100,$2) RETURNING id",[partner,key])).rows[0].id;
  const work=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",[key])).rows[0].id;
  await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",[site,work,vendor]);
  const gate=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Main Gate') RETURNING id",[site])).rows[0].id;
  const people:SessionPayload[]=[];
  for(const role of ['gatekeeper','gate_supervisor','office','office']){
    const user=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture-hash','vendor',$2) RETURNING id",[randomUUID(),role])).rows[0].id;
    const person=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,'Test','test@example.invalid') RETURNING id",[vendor,user,role])).rows[0].id;
    const membership:number=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,$3,$4) RETURNING id",[user,vendor,people.length===3?'admin':'member',person])).rows[0].id;
    people.push({userId:user,vendorId:vendor,activeMembershipId:membership,vendorRole:role,membershipRole:people.length===3?'admin':'member',role:'vendor',sv:1});
  }
  const [worker,scheduler]=people;
  const starts=new Date(Date.now()+hours*3600000),ends=new Date(+starts+12*3600000);
  const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Gate watch',$2,$3,'America/Chicago',$4,$5,$6) RETURNING id",[vendor,starts,ends,scheduler.userId,site,gate])).rows[0].id;
  const assignment=(await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id) VALUES($1,$2,$3) RETURNING id",[shift,worker.userId,scheduler.userId])).rows[0].id;
  return {worker,scheduler,people,shift,assignment,vendor};
}
it('stores an urgent conflict once, retains the assignment, and alerts scheduler plus office/admin in the company',async()=>{
  const f=await fixture();const body={operationId:randomUUID(),assignmentId:f.assignment,expectedVersion:1,response:'conflict' as const,reason:'Personal schedule conflict'};
  await pool.query("INSERT INTO workforce_assignment_states(shift_id,worker_user_id,acknowledgement_due_at,assigned_by_id,operation_id) VALUES($1,$2,now(),$3,$4)",[f.shift,f.worker.userId,f.scheduler.userId,randomUUID()]);
  expect((await listMyScheduledWatches(f.worker)).watches[0]).toMatchObject({id:f.shift,scheduler:{userId:f.scheduler.userId},response:'pending'});
  expect(await respondToScheduledWatch(f.worker,f.shift,body)).toMatchObject({response:'conflict',escalated:true,notifiedCount:3});
  await respondToScheduledWatch(f.worker,f.shift,body);
  const notices=(await pool.query("SELECT user_id,body FROM notifications WHERE dedupe_key LIKE $1",[`gate-watch-response:${body.operationId}:%`])).rows;
  expect(notices.map(n=>n.user_id).sort()).toEqual(f.people.slice(1).map(p=>p.userId).sort());expect(notices.every(n=>!n.body.includes(body.reason))).toBe(true);
  expect((await pool.query("SELECT status FROM work_hub_shift_assignments WHERE id=$1",[f.assignment])).rows[0].status).toBe('assigned');
  expect((await pool.query("SELECT state FROM workforce_assignment_states WHERE shift_id=$1 AND worker_user_id=$2",[f.shift,f.worker.userId])).rows[0].state).toBe('declined');
  expect((await listMyScheduledWatches(f.worker)).watches[0]).toMatchObject({response:'conflict',escalated:true});
  await respondToScheduledWatch(f.worker,f.shift,{...body,operationId:randomUUID(),response:'confirm',reason:undefined});
  expect((await listMyScheduledWatches(f.worker)).watches[0].response).toBe('confirmed');
  expect((await pool.query("SELECT status FROM work_hub_shift_assignments WHERE id=$1",[f.assignment])).rows[0].status).toBe('accepted');
  expect((await pool.query("SELECT state FROM workforce_assignment_states WHERE shift_id=$1 AND worker_user_id=$2",[f.shift,f.worker.userId])).rows[0].state).toBe('acknowledged');
});
it('notifies only the scheduler with more than 24 hours notice and rejects another worker or stale assignment',async()=>{
  const f=await fixture(48);const body={operationId:randomUUID(),assignmentId:f.assignment,expectedVersion:1,response:'conflict' as const,reason:'Scheduling conflict'};
  await expect(respondToScheduledWatch(f.scheduler,f.shift,body)).rejects.toMatchObject({status:404});
  await expect(respondToScheduledWatch(f.worker,f.shift,{...body,expectedVersion:2})).rejects.toMatchObject({status:409});
  expect(await respondToScheduledWatch(f.worker,f.shift,body)).toMatchObject({escalated:false,notifiedCount:1});
  const other=await fixture();
  expect((await listMyScheduledWatches(other.worker)).watches.some(w=>w.id===f.shift)).toBe(false);
  await expect(respondToScheduledWatch(other.worker,f.shift,{...body,operationId:randomUUID()})).rejects.toMatchObject({status:404});
});
