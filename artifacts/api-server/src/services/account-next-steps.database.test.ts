import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import type { SessionPayload } from "../lib/session";

const storage=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../lib/objectStorage",()=>({ObjectStorageService:class {getStoredObject=storage.read}}));

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)("saved account setup and first watch database workflow", () => {
  let pool: typeof import("@workspace/db")["pool"];
  let summary: typeof import("./account-next-steps")["readAccountNextSteps"];
  let assume: typeof import("./gate-change-over")["assumeGateWatch"];
  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    ({pool} = await import("@workspace/db"));
    const target = new URL(process.env.DATABASE_URL!);
    expect((await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0]).toEqual({database:process.env.VNDRLY_FRESH_TEST_DB_NAME,address:"127.0.0.1",port:Number(target.port)});
    ({readAccountNextSteps:summary} = await import("./account-next-steps"));
    ({assumeGateWatch:assume} = await import("./gate-change-over"));
  });
  async function fixture() {
    const key=randomUUID();
    const partner=(await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic','synthetic@example.invalid') RETURNING id",[key])).rows[0].id;
    const vendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email,operations_categories,coi_document_url) VALUES($1,'Synthetic','synthetic@example.invalid',ARRAY['gate'],'/synthetic-saved-coi.pdf') RETURNING id",[key])).rows[0].id;
    const office=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'unusable-synthetic','vendor','Synthetic office') RETURNING id",[`office-${key}`])).rows[0].id;
    const worker=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'unusable-synthetic','field_employee','Synthetic worker') RETURNING id",[`worker-${key}`])).rows[0].id;
    const person=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,last_name,email,phone,photo_url) VALUES($1,$2,'gatekeeper','Synthetic','Worker','synthetic@example.invalid','5555555555','/synthetic-photo.jpg') RETURNING id",[vendor,worker])).rows[0].id;
    const officeMembership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",[office,vendor])).rows[0].id;
    const workerMembership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'field_employee',$3) RETURNING id",[worker,vendor,person])).rows[0].id;
    const work=(await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",[key])).rows[0].id;
    const site=(await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Synthetic',30,-100,$3) RETURNING id",[partner,key,randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",[site,work,vendor]);
    await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",[partner,vendor]);
    const officeSession:SessionPayload={userId:office,role:"vendor",vendorId:vendor,activeMembershipId:officeMembership,membershipRole:"admin",sv:1};
    const workerSession:SessionPayload={userId:worker,role:"field_employee",vendorId:vendor,activeMembershipId:workerMembership,membershipRole:"field_employee",vendorRole:"gatekeeper",sv:1};
    return {partner,vendor,office,worker,person,work,site,officeSession,workerSession};
  }
  async function stage(f:Awaited<ReturnType<typeof fixture>>) {
    const station=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Synthetic Main Gate') RETURNING id",[f.site])).rows[0].id;
    await pool.query("INSERT INTO vendor_person_operational_roles(vendor_people_id,role) VALUES($1,'gatekeeper')",[f.person]);
    await pool.query("INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)",[f.person,f.site]);
    const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic watch',now()-interval '1 hour',now()+interval '8 hours','America/Chicago',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,station])).rows[0].id;
    await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[shift,f.worker]);
    return {station,shift};
  }
  async function approve(f:Awaited<ReturnType<typeof fixture>>) {
    await pool.query("INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,unit) VALUES($1,$2,50,'per_hour')",[f.vendor,f.work]);
    await pool.query("INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,approved_unit) VALUES($1,$2,$3,50,'per_hour')",[f.partner,f.vendor,f.work]);
  }
  it("offers only the next missing saved step in one site/station/shift chain",async()=>{
    const f=await fixture();
    const station=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Synthetic setup gate') RETURNING id",[f.site])).rows[0].id;
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toContain("access to this site");
    await pool.query("INSERT INTO vendor_person_operational_roles(vendor_people_id,role) VALUES($1,'gatekeeper')",[f.person]);
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toContain("access to this site");
    await pool.query("INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)",[f.person,f.site]);
    expect((await summary(f.officeSession)).firstWatch?.action).toMatchObject({title:"Create a shift for this gate station",href:expect.stringContaining(`siteId=${f.site}&stationId=${station}`)});
    const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic setup shift',now()-interval '1 hour',now()+interval '8 hours','America/Chicago',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,station])).rows[0].id;
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({complete:false,action:{title:"Assign an eligible gate employee to this shift",href:expect.stringContaining(`shiftId=${shift}`)},context:{siteId:f.site,stationId:station,shiftId:shift}});
    expect((await summary(f.workerSession)).firstWatch?.action).toBeNull();
  });
  it("saves an uploaded COI for the current administrator without requiring review, and denies another company",async()=>{
    const f=await fixture(),other=await fixture();
    await pool.query("UPDATE vendors SET coi_document_url=NULL WHERE id=$1",[f.vendor]);
    expect((await summary(f.officeSession)).coiUploadNeeded).toBe(true);
    const path=`/objects/uploads/${randomUUID()}`;
    storage.read.mockResolvedValue({acl:{owner:String(f.office),visibility:"private"},contentType:"application/pdf",size:500});
    const {saveAccountCoi}=await import("./account-next-steps");
    await expect(saveAccountCoi({...f.officeSession,vendorId:other.vendor},path)).rejects.toMatchObject({status:403});
    expect(storage.read).not.toHaveBeenCalled();
    await expect(saveAccountCoi(f.officeSession,path)).resolves.toEqual({uploaded:true});
    expect((await summary(f.officeSession)).coiUploadNeeded).toBe(false);
    expect((await pool.query("SELECT coi_document_url FROM vendors WHERE id=$1",[f.vendor])).rows[0].coi_document_url).toBe(`/api/storage${path}`);
    expect((await pool.query("SELECT coi_document_url FROM vendors WHERE id=$1",[other.vendor])).rows[0].coi_document_url).toBe("/synthetic-saved-coi.pdf");
  });
  it("advances from saved setup to one watch and one real automatic ticket, including replay", async () => {
    const f=await fixture();
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toBe("Set up a gate site and station");
    const {station,shift}=await stage(f);
    await approve(f);
    const waiting=await summary(f.officeSession);
    expect(waiting).toMatchObject({coiUploadNeeded:false,firstWatch:{complete:false,action:null,context:{siteId:f.site,stationId:station,shiftId:shift,assignedUserId:f.worker}}});
    expect(waiting.firstWatch?.message).toContain("Waiting on the assigned gatekeeper");
    const ready=await summary(f.workerSession);
    expect(ready.firstWatch?.action?.title).toBe("Assume Watch");
    expect(ready.credentials).toEqual([]);
    const command={stationId:station,operationId:randomUUID(),source:"web" as const,expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true};
    await assume(f.workerSession,command);
    await assume(f.workerSession,command);
    const completed=await summary(f.officeSession);
    expect(completed.firstWatch).toMatchObject({complete:true,action:null,context:{siteId:f.site,stationId:station,shiftId:shift}});
    const ticketId=completed.firstWatch!.context!.ticketId!;
    const tickets=(await pool.query("SELECT id,field_employee_id,status,lifecycle_state,check_in_time FROM tickets WHERE vendor_id=$1",[f.vendor])).rows;
    expect(tickets).toEqual([{id:ticketId,field_employee_id:f.person,status:"initiated",lifecycle_state:"pending_arrival",check_in_time:null}]);
    expect((await pool.query("SELECT to_status FROM ticket_status_history WHERE ticket_id=$1",[ticketId])).rows).toEqual([{to_status:"initiated"}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[station])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT work_hub_shift_id,source_legacy_shift_id,post_coverage FROM gate_duty_sessions WHERE station_id=$1",[station])).rows[0]).toMatchObject({work_hub_shift_id:shift,source_legacy_shift_id:completed.firstWatch!.context!.watchId,post_coverage:{vendorId:f.vendor,ticketId}});
    await pool.query("UPDATE vendor_person_site_access SET is_active=false WHERE vendor_people_id=$1 AND site_location_id=$2",[f.person,f.site]);
    expect((await summary(f.officeSession)).firstWatch?.complete).toBe(false);
  });
  it("rolls back a watch when no approved automatic-ticket service exists",async()=>{
    const f=await fixture(),{station}=await stage(f);
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toBe("Review gate service setup");
    await expect(assume(f.workerSession,{stationId:station,operationId:randomUUID(),source:"web",expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true})).rejects.toMatchObject({status:409});
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[station])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM tickets WHERE vendor_id=$1",[f.vendor])).rows[0].n).toBe(0);
  });
  it("does not start a future assigned shift or create an unbound watch and ticket",async()=>{
    const f=await fixture(),{station,shift}=await stage(f);
    await approve(f);
    await pool.query("UPDATE work_hub_shifts SET starts_at=now()+interval '1 day',ends_at=now()+interval '2 days' WHERE id=$1",[shift]);
    const waiting=await summary(f.workerSession);
    expect(waiting.firstWatch).toMatchObject({complete:false,action:null,context:{shiftId:shift}});
    expect(waiting.firstWatch?.message).toContain("scheduled shift to begin");
    await expect(assume(f.workerSession,{stationId:station,operationId:randomUUID(),source:"web",expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true})).rejects.toMatchObject({status:409});
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[station])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM tickets WHERE vendor_id=$1",[f.vendor])).rows[0].n).toBe(0);
  });
  it("never presents another Assume for a saved watch without a ticket and rejects a suspended current account",async()=>{
    const f=await fixture(),{station,shift}=await stage(f);
    const watch=(await pool.query("INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING id",[station,f.worker])).rows[0].id;
    await pool.query("INSERT INTO gate_duty_sessions(station_id,user_id,work_hub_shift_id,source_legacy_shift_id,source,idempotency_key,post_coverage) VALUES($1,$2,$3,$4,'web',$5,$6::jsonb)",[station,f.worker,shift,watch,randomUUID(),JSON.stringify({vendorId:f.vendor})]);
    expect((await summary(f.workerSession)).firstWatch).toMatchObject({complete:false,action:null});
    expect((await summary(f.workerSession)).firstWatch?.message).toContain("do not assume");
    await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1",[f.worker]);
    await expect(summary(f.workerSession)).rejects.toMatchObject({status:403});
  });
});
