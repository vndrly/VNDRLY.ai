import { beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { listGateWatchTimeline } from "./gate-watch-timeline";

beforeAll(async () => {
  if (process.env.VNDRLY_TEST_DB_MODE !== "fresh-local") throw Error("Requires an isolated fresh local database");
  await pool.query(await readFile(new URL("../../../../lib/db/drizzle/gate_change_over.sql", import.meta.url), "utf8"));
});
const at = new Date("2026-10-27T12:00:00Z");
async function fixture() {
  const key = randomUUID();
  const partner = (await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id", [key])).rows[0].id;
  const vendor = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id", [key])).rows[0].id;
  const work = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [key])).rows[0].id;
  const user = (await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture-hash','vendor','Test watchstander') RETURNING id", [key])).rows[0].id;
  const person = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper','Test','test@example.invalid') RETURNING id", [vendor,user])).rows[0].id;
  const membership = (await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id", [user,vendor,person])).rows[0].id;
  const sites: {id:number;gate:string;secondGate:string}[] = [];
  for (const name of ["West site", "East site"]) {
    const id = (await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Test',30,-100,$3) RETURNING id", [partner,name,randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [id,work,vendor]);
    const gates = (await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Main Gate'),($1,'East Gate') RETURNING id", [id])).rows;
    sites.push({id,gate:gates[0].id,secondGate:gates[1].id});
  }
  const session:SessionPayload = {userId:user,role:"vendor",vendorId:vendor,activeMembershipId:membership,vendorRole:"gatekeeper",membershipRole:"member",sv:1};
  return {user,vendor,session,sites};
}
async function watch(f:Awaited<ReturnType<typeof fixture>>, gate:string, ended:string|null, notes?:string, acknowledged=false) {
  const id = (await pool.query("INSERT INTO gate_shifts(station_id,operator_id,started_at,ended_at) VALUES($1,$2,'2026-10-25T00:00:00Z',$3) RETURNING id", [gate,f.user,ended])).rows[0].id;
  let handoffId:string|null = null;
  if (notes !== undefined) {
    const prep = (await pool.query("INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,'{}',$3,'{}') RETURNING id", [id,f.user,notes])).rows[0].id;
    await pool.query("UPDATE gate_shifts SET preparation_id=$2 WHERE id=$1", [id,prep]);
    if (acknowledged) {
      const incoming = (await pool.query("INSERT INTO gate_shifts(station_id,operator_id,started_at,ended_at) VALUES($1,$2,'2026-10-25T00:00:00Z','2026-10-25T01:00:00Z') RETURNING id", [gate,f.user])).rows[0].id;
      handoffId = (await pool.query("INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name) VALUES($1,$2,$3,$4,'Test watchstander','Incoming') RETURNING id", [randomUUID(),prep,incoming,f.user])).rows[0].id;
    }
  }
  return {id,handoffId};
}
async function scheduled(f:Awaited<ReturnType<typeof fixture>>, site:typeof f.sites[number], starts:string, people=true, status="upcoming") {
  const id = (await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id,milestone_status) VALUES('vendor',$1,'Scheduled watch',$2,$2::timestamptz+interval '12 hours','America/Chicago',$3,$4,$5,$6) RETURNING id", [f.vendor,starts,f.user,site.id,site.gate,status])).rows[0].id;
  if (people) await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,assigned_by_id) VALUES($1,$2,$2)", [id,f.user]);
  return id;
}
it("chooses the latest completed watch across gates at each site, with its exact notes and handoff link", async () => {
  const f=await fixture(),west=f.sites[0],east=f.sites[1];
  await watch(f,west.gate,"2026-10-26T00:00:00Z","Older notes",true);
  const latest=await watch(f,west.secondGate,"2026-10-27T10:00:00Z","Latest West notes",true);
  await watch(f,west.gate,null,"Current watch notes");
  const released=await watch(f,east.gate,"2026-10-27T09:00:00Z","Released notes awaiting review");
  const result=await listGateWatchTimeline(f.session,at);
  expect(result.sites).toHaveLength(2);
  expect(result.sites.find(s=>s.siteId===west.id)?.previous).toMatchObject({watchId:latest.id,notes:"Latest West notes",handoffId:latest.handoffId,gateName:"East Gate"});
  expect(result.sites.find(s=>s.siteId===east.id)?.previous).toMatchObject({watchId:released.id,notes:"Released notes awaiting review",handoffId:null});
});
it("does not substitute older notes or cancelled drafts for the latest completed watch", async () => {
  const f=await fixture(),site=f.sites[0];
  await watch(f,site.gate,"2026-10-26T00:00:00Z","Older saved notes",true);
  const latest=await watch(f,site.gate,"2026-10-27T10:00:00Z");
  await pool.query("INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary) VALUES($1,$2,'{}','Cancelled draft','{}')", [latest.id,f.user]);
  const result=await listGateWatchTimeline(f.session,at);
  expect(result.sites.find(s=>s.siteId===site.id)?.previous).toMatchObject({watchId:latest.id,notes:null,filedAt:null,handoffId:null});
  expect(result.sites.find(s=>s.siteId===f.sites[1].id)?.previous).toBeNull();
});
it("shows the earliest future slot including an unassigned slot, ignoring cancelled and completed schedules", async () => {
  const f=await fixture(),west=f.sites[0],east=f.sites[1];
  await scheduled(f,west,"2026-10-27T10:00:00Z");
  await scheduled(f,west,"2026-10-27T13:00:00Z",true,"cancelled");
  await scheduled(f,west,"2026-10-27T14:00:00Z",true,"completed");
  const next=await scheduled(f,west,"2026-10-27T15:00:00Z",false);
  await scheduled(f,west,"2026-10-27T16:00:00Z");
  const staffed=await scheduled(f,east,"2026-10-27T14:00:00Z");
  const result=await listGateWatchTimeline(f.session,at);
  expect(result.sites.find(s=>s.siteId===west.id)?.next).toMatchObject({shiftId:next,people:[]});
  expect(result.sites.find(s=>s.siteId===east.id)?.next).toMatchObject({shiftId:staffed,people:[{userId:f.user,name:"Test watchstander"}]});
});
it("does not expose another vendor's history or schedules even at a shared site", async () => {
  const f=await fixture(),other=await fixture(),site=f.sites[0];
  await watch(other,site.gate,"2026-10-27T10:00:00Z","Foreign company notes",true);
  await scheduled(other,site,"2026-10-27T13:00:00Z");
  const result=await listGateWatchTimeline(f.session,at);
  expect(result.sites.map(s=>s.siteId).sort()).toEqual(f.sites.map(s=>s.id).sort());
  expect(result.sites.find(s=>s.siteId===site.id)).toMatchObject({previous:null,next:null});
  await expect(listGateWatchTimeline({...f.session,sv:99},at)).rejects.toMatchObject({status:401});
});
