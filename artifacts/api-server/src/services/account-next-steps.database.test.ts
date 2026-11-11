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
  async function stationFor(f:Awaited<ReturnType<typeof fixture>>,name:string) {
    // Earlier additive-migration suites may have installed the real default-gate
    // trigger. Reuse its saved gate instead of introducing a second earlier chain.
    const existing=(await pool.query("SELECT id FROM gate_stations WHERE site_id=$1 ORDER BY created_at,id LIMIT 1",[f.site])).rows[0];
    return existing?.id ?? (await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id",[f.site,name])).rows[0].id;
  }
  async function stage(f:Awaited<ReturnType<typeof fixture>>) {
    const station=await stationFor(f,"Synthetic Main Gate");
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
  async function managedFixture() {
    const f=await fixture(),key=randomUUID();
    const managedUser=(await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'unusable-synthetic','field_employee','Synthetic contractor') RETURNING id",[`managed-${key}`])).rows[0].id;
    const membership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'field_employee') RETURNING id",[managedUser,f.vendor])).rows[0].id;
    const organization=(await pool.query("INSERT INTO managed_subcontractor_organizations(name,canonical_name,created_by_vendor_id,created_by_user_id) VALUES($1,$1,$2,$3) RETURNING id",[key,f.vendor,f.office])).rows[0].id;
    const sponsor=(await pool.query("INSERT INTO managed_subcontractor_sponsors(managed_organization_id,sponsor_vendor_id,created_by_user_id) VALUES($1,$2,$3) RETURNING id",[organization,f.vendor,f.office])).rows[0].id;
    const sponsorship=(await pool.query("INSERT INTO managed_subcontractor_worker_sponsorships(worker_user_id,sponsor_vendor_id,managed_organization_id,invited_by_user_id) VALUES($1,$2,$3,$4) RETURNING id",[managedUser,f.vendor,organization,f.office])).rows[0].id;
    const managedSession:SessionPayload={userId:managedUser,role:"field_employee",vendorId:f.vendor,activeMembershipId:membership,membershipRole:"field_employee",sv:1,managedSubcontractor:{siteGrants:[{siteId:f.site,role:"gatekeeper"}]}};
    return {...f,managedUser,organization,sponsor,sponsorship,membership,managedSession};
  }
  async function managedStage(f:Awaited<ReturnType<typeof managedFixture>>) {
    const station=await stationFor(f,"Synthetic subcontractor gate");
    const grant=(await pool.query("INSERT INTO managed_subcontractor_role_grants(sponsorship_id,role,site_id,granted_by_user_id) VALUES($1,'gatekeeper',$2,$3) RETURNING id",[f.sponsorship,f.site,f.office])).rows[0].id;
    const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic subcontractor watch',now()-interval '1 hour',now()+interval '8 hours','America/Chicago',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,station])).rows[0].id;
    await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[shift,f.managedUser]);
    return {station,grant,shift};
  }
  it("offers only the next missing saved step in one site/station/shift chain",async()=>{
    const f=await fixture();
    const station=await stationFor(f,"Synthetic setup gate");
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
    const initialStations=(await pool.query("SELECT id FROM gate_stations WHERE site_id=$1",[f.site])).rows;
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toBe(initialStations.length ? "Give an eligible gate employee access to this site" : "Add a gate station at this site");
    const {station,shift}=await stage(f);
    await approve(f);
    const waiting=await summary(f.officeSession);
    expect(waiting).toMatchObject({coiUploadNeeded:false,firstWatch:{complete:false,action:null,context:{siteId:f.site,stationId:station,shiftId:shift,assignedUserId:f.worker,employeeId:f.person,employeeKind:"direct",managedOrganizationId:null,managedWorkerId:null}}});
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
  it("offers gate creation only for an actually authorized saved site without an active station",async()=>{
    const f=await fixture();
    await pool.query("UPDATE gate_stations SET active=false WHERE site_id=$1",[f.site]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:{title:"Add a gate station at this site",href:`/gate-locations?siteId=${f.site}`},context:{siteId:f.site,stationId:null,stationName:null}});
    await pool.query("UPDATE partner_vendor_relationships SET status='revoked' WHERE vendor_id=$1 AND partner_id=$2",[f.vendor,f.partner]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:null,message:expect.stringContaining("Gate service authorization"),context:null});
  });
  it("keeps the saved watch when automatic ticket confirmation has no approved service",async()=>{
    const f=await fixture(),{station,shift}=await stage(f);
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toBe("Review gate service setup");
    await expect(assume(f.workerSession,{stationId:station,operationId:randomUUID(),source:"web",expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true})).resolves.toMatchObject({ticketId:null,ticketStatus:"unavailable"});
    const pending = (await summary(f.workerSession)).firstWatch;
    expect(pending).toMatchObject({complete:false,action:null,context:{watchId:expect.any(String),ticketId:null}});
    expect((await pool.query("SELECT count(*)::int AS n FROM tickets WHERE vendor_id=$1",[f.vendor])).rows[0].n).toBe(0);
    await approve(f);
    const watchId = pending!.context!.watchId!;
    expect((await summary(f.workerSession)).firstWatch?.action).toMatchObject({recordType:"watch-ticket",recordId:watchId});
    const {confirmAccountWatchTicket} = await import("./account-next-steps");
    const result = await confirmAccountWatchTicket(f.workerSession,watchId,shift);
    expect(result.ticketId).toEqual(expect.any(Number));
    expect((await confirmAccountWatchTicket(f.workerSession,watchId,shift)).ticketId).toBe(result.ticketId);
    expect((await summary(f.workerSession)).firstWatch).toMatchObject({complete:true,action:null,context:{watchId,ticketId:result.ticketId}});
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[station])).rows[0].n).toBe(1);
  });
  it("waits for a future shift and preserves manually assumed coverage without starting its ticket",async()=>{
    const f=await fixture(),{station,shift}=await stage(f);
    await approve(f);
    await pool.query("UPDATE work_hub_shifts SET starts_at=now()+interval '1 day',ends_at=now()+interval '2 days' WHERE id=$1",[shift]);
    const waiting=await summary(f.workerSession);
    expect(waiting.firstWatch).toMatchObject({complete:false,action:null,context:{shiftId:shift}});
    expect(waiting.firstWatch?.message).toContain("scheduled shift to begin");
    await expect(assume(f.workerSession,{stationId:station,operationId:randomUUID(),source:"web",expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true})).resolves.toMatchObject({ticketId:null,ticketBlocker:"gate_ticket.shift_not_started"});
    expect((await summary(f.workerSession)).firstWatch).toMatchObject({complete:false,action:null,context:{watchId:expect.any(String),ticketId:null}});
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
  it("keeps a saved partner order company-scoped and ranks equally urgent safety records", async () => {
    const f = await fixture(), other = await fixture();
    const {saveNextStepsPartnerOrder} = await import("./account-next-steps");
    await expect(saveNextStepsPartnerOrder(f.officeSession,[other.partner])).rejects.toMatchObject({status:403});
    await expect(saveNextStepsPartnerOrder(f.workerSession,[f.partner])).rejects.toMatchObject({status:403});
    await pool.query("INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",[other.partner,f.vendor]);
    await expect(saveNextStepsPartnerOrder(f.officeSession,[other.partner,f.partner])).resolves.toEqual({order:[other.partner,f.partner]});
    for (const source of [f,other]) {
      await pool.query("INSERT INTO safety_events(event_number,event_type,title,site_location_id,partner_id,vendor_id,reported_by_user_id,is_stop_work) VALUES($1,'near_miss',$2,$3,$4,$5,$6,true)",[randomUUID(),`Stop work at ${source.site}`,source.site,source.partner,f.vendor,f.office]);
    }
    const admin = await summary(f.officeSession);
    expect(admin.partnerSettings?.order).toEqual([other.partner,f.partner]);
    expect(admin.partnerSettings?.configured).toBe(true);
    expect(admin.workflows?.filter(flow=>flow.id.startsWith("safety:")).map(flow=>flow.title)).toEqual([
      `Review work stoppage · Stop work at ${other.site}`,`Review work stoppage · Stop work at ${f.site}`,
    ]);
    expect((await summary(f.workerSession)).workflows?.some(flow=>flow.id.startsWith("safety:"))).toBe(false);
    await saveNextStepsPartnerOrder(f.officeSession,[]);
    expect((await summary(f.officeSession)).partnerSettings).toMatchObject({order:[],configured:true});
  });
  it("advances a saved managed Gate worker from site access through the same shift and completed watch",async()=>{
    const f=await managedFixture(),station=await stationFor(f,"Synthetic managed setup gate");
    expect((await summary(f.officeSession)).firstWatch?.action?.title).toBe("Give an eligible gate employee access to this site");
    await pool.query("INSERT INTO managed_subcontractor_role_grants(sponsorship_id,role,site_id,granted_by_user_id) VALUES($1,'gatekeeper',$2,$3)",[f.sponsorship,f.site,f.office]);
    const eligible=await summary(f.officeSession);
    expect(eligible.firstWatch).toMatchObject({complete:false,action:{title:"Create a shift for this gate station",href:expect.stringContaining(`siteId=${f.site}&stationId=${station}&employee=${f.managedUser}`)},context:{siteId:f.site,stationId:station,employeeId:null,eligibleUserId:f.managedUser,employeeKind:"managed",managedOrganizationId:f.organization,managedWorkerId:f.sponsorship}});
    expect((await pool.query("SELECT id FROM vendor_people WHERE user_id=$1",[f.managedUser])).rows).toEqual([]);
    const shift=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic managed setup shift',now()-interval '1 hour',now()+interval '8 hours','America/Chicago',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,station])).rows[0].id;
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:{title:"Assign an eligible gate employee to this shift"},context:{shiftId:shift,eligibleUserId:f.managedUser,employeeId:null}});
    await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[shift,f.managedUser]);
    await approve(f);
    const waiting=await summary(f.officeSession);
    expect(waiting.firstWatch).toMatchObject({action:null,message:expect.stringContaining("Waiting on the assigned gatekeeper"),context:{shiftId:shift,assignedUserId:f.managedUser,employeeId:null}});
    expect((await summary(f.managedSession)).firstWatch?.action?.title).toBe("Assume Watch");
    const command={stationId:station,operationId:randomUUID(),source:"web" as const,expectedWatchId:null,preparationId:null,acknowledged:true,allowUnprepared:true};
    await assume(f.managedSession,command);
    await assume(f.managedSession,command);
    const completed=await summary(f.officeSession);
    expect(completed.firstWatch).toMatchObject({complete:true,action:null,context:{siteId:f.site,stationId:station,shiftId:shift,employeeId:null,eligibleUserId:f.managedUser,assignedUserId:f.managedUser,employeeKind:"managed",managedWorkerId:f.sponsorship}});
    const tickets=(await pool.query("SELECT id,field_employee_id,status,lifecycle_state FROM tickets WHERE vendor_id=$1",[f.vendor])).rows;
    expect(tickets).toEqual([{id:completed.firstWatch!.context!.ticketId,field_employee_id:null,status:"initiated",lifecycle_state:"pending_arrival"}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shifts WHERE station_id=$1",[station])).rows[0].n).toBe(1);
    expect((await summary(f.managedSession)).firstWatch).toMatchObject({complete:true,action:null});
    expect((await summary(f.managedSession)).credentials).toEqual([]);
  });
  it.each(["terminated sponsorship","ended sponsorship","paused sponsorship","revoked grant","ended grant","inactive sponsor","ended sponsor","missing membership","suspended worker","archived company"] as const)("does not offer a managed worker with %s as saved eligibility",async(reason)=>{
    const f=await managedFixture(),{grant}=await managedStage(f);
    if(reason==="terminated sponsorship")await pool.query("UPDATE managed_subcontractor_worker_sponsorships SET status='terminated',ended_at=now() WHERE id=$1",[f.sponsorship]);
    if(reason==="ended sponsorship")await pool.query("UPDATE managed_subcontractor_worker_sponsorships SET ended_at=now() WHERE id=$1",[f.sponsorship]);
    if(reason==="paused sponsorship")await pool.query("UPDATE managed_subcontractor_worker_sponsorships SET status='paused' WHERE id=$1",[f.sponsorship]);
    if(reason==="revoked grant")await pool.query("UPDATE managed_subcontractor_role_grants SET status='inactive',ended_at=now() WHERE id=$1",[grant]);
    if(reason==="ended grant")await pool.query("UPDATE managed_subcontractor_role_grants SET ended_at=now() WHERE id=$1",[grant]);
    if(reason==="inactive sponsor")await pool.query("UPDATE managed_subcontractor_sponsors SET status='inactive',ended_at=now() WHERE id=$1",[f.sponsor]);
    if(reason==="ended sponsor")await pool.query("UPDATE managed_subcontractor_sponsors SET ended_at=now() WHERE id=$1",[f.sponsor]);
    if(reason==="missing membership")await pool.query("DELETE FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND vendor_id=$3",[f.membership,f.managedUser,f.vendor]);
    if(reason==="suspended worker")await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1",[f.managedUser]);
    if(reason==="archived company")await pool.query("UPDATE managed_subcontractor_organizations SET status='archived' WHERE id=$1",[f.organization]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({complete:false,action:{title:"Give an eligible gate employee access to this site"},context:{employeeId:null,eligibleUserId:null,assignedUserId:null}});
  });
  it("requires the managed worker's grant and sponsorship to belong to the same company and site",async()=>{
    const f=await managedFixture(),other=await fixture(),{grant}=await managedStage(f);
    await pool.query("UPDATE managed_subcontractor_role_grants SET site_id=$2 WHERE id=$1",[grant,other.site]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:{title:"Give an eligible gate employee access to this site"},context:{siteId:f.site,eligibleUserId:null}});
    await pool.query("UPDATE managed_subcontractor_role_grants SET site_id=$2 WHERE id=$1",[grant,f.site]);
    await pool.query("UPDATE managed_subcontractor_worker_sponsorships SET sponsor_vendor_id=$2 WHERE id=$1",[f.sponsorship,other.vendor]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:{title:"Give an eligible gate employee access to this site"},context:{siteId:f.site,eligibleUserId:null}});
  });
  it("does not borrow a revoked sponsorship's Gate grant for a different active sponsorship",async()=>{
    const f=await managedFixture();
    await managedStage(f);
    await pool.query("UPDATE managed_subcontractor_worker_sponsorships SET status='terminated',ended_at=now() WHERE id=$1",[f.sponsorship]);
    const key=randomUUID(),organization=(await pool.query("INSERT INTO managed_subcontractor_organizations(name,canonical_name,created_by_vendor_id,created_by_user_id) VALUES($1,$1,$2,$3) RETURNING id",[key,f.vendor,f.office])).rows[0].id;
    await pool.query("INSERT INTO managed_subcontractor_sponsors(managed_organization_id,sponsor_vendor_id,created_by_user_id) VALUES($1,$2,$3)",[organization,f.vendor,f.office]);
    await pool.query("INSERT INTO managed_subcontractor_worker_sponsorships(worker_user_id,sponsor_vendor_id,managed_organization_id,invited_by_user_id) VALUES($1,$2,$3,$4)",[f.managedUser,f.vendor,organization,f.office]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({complete:false,action:{title:"Give an eligible gate employee access to this site"},context:{eligibleUserId:null,managedWorkerId:null}});
  });
  it("keeps a real direct employee identity when the same user also has managed Gate access",async()=>{
    const f=await managedFixture();
    await managedStage(f);
    await approve(f);
    const person=(await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,last_name,email,phone) VALUES($1,$2,'gatekeeper','Synthetic','Direct worker','synthetic@example.invalid','5555555555') RETURNING id",[f.vendor,f.managedUser])).rows[0].id;
    await pool.query("UPDATE user_org_memberships SET vendor_people_id=$2 WHERE id=$1",[f.membership,person]);
    await pool.query("INSERT INTO vendor_person_site_access(vendor_people_id,site_location_id) VALUES($1,$2)",[person,f.site]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({complete:false,action:null,context:{employeeId:person,eligibleUserId:f.managedUser,employeeKind:"direct",managedOrganizationId:null,managedWorkerId:null}});
  });
  it("never repeats Assume for a managed worker's saved watch awaiting its automatic ticket",async()=>{
    const f=await managedFixture(),{station,shift}=await managedStage(f);
    const watch=(await pool.query("INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING id",[station,f.managedUser])).rows[0].id;
    await pool.query("INSERT INTO gate_duty_sessions(station_id,user_id,work_hub_shift_id,source_legacy_shift_id,source,idempotency_key,post_coverage) VALUES($1,$2,$3,$4,'web',$5,$6::jsonb)",[station,f.managedUser,shift,watch,randomUUID(),JSON.stringify({vendorId:f.vendor})]);
    expect((await summary(f.managedSession)).firstWatch).toMatchObject({complete:false,action:null,message:expect.stringContaining("do not assume"),context:{employeeId:null,eligibleUserId:f.managedUser,shiftId:shift,watchId:watch,ticketId:null}});
    expect((await summary(f.officeSession)).firstWatch?.action).toBeNull();
  });
  it("checks the selected shift when the managed worker has two assignments at one gate",async()=>{
    const f=await managedFixture(),{station,shift}=await managedStage(f);
    await approve(f);
    const sibling=(await pool.query("INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,created_by_id,site_location_id,gate_station_id) VALUES('vendor',$1,'Synthetic sibling watch',now()-interval '30 minutes',now()+interval '9 hours','America/Chicago',$2,$3,$4) RETURNING id",[f.vendor,f.office,f.site,station])).rows[0].id;
    await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id) VALUES($1,$2)",[sibling,f.managedUser]);
    await pool.query("UPDATE work_hub_shifts SET ticket_number='999999999' WHERE id=$1",[shift]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:{title:"Review gate service setup"},context:{siteId:f.site,stationId:station,shiftId:shift,eligibleUserId:f.managedUser,ticketBlocker:"gate_ticket.scheduled_ticket_unavailable"}});
    await pool.query("UPDATE work_hub_shifts SET ticket_number=NULL WHERE id=$1",[shift]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({action:null,message:expect.stringContaining("Waiting on the assigned gatekeeper"),context:{shiftId:shift,ticketBlocker:null}});
    expect((await summary(f.managedSession)).firstWatch).toMatchObject({action:{title:"Assume Watch"},context:{shiftId:shift,ticketBlocker:null}});
    const ticket=(await pool.query("INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status) VALUES($1,$2,$3,'initiated') RETURNING id",[f.site,f.vendor,f.work])).rows[0].id;
    const watch=(await pool.query("INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING id",[station,f.managedUser])).rows[0].id;
    await pool.query("INSERT INTO gate_duty_sessions(station_id,user_id,work_hub_shift_id,source_legacy_shift_id,source,idempotency_key,post_coverage) VALUES($1,$2,$3,$4,'web',$5,$6::jsonb)",[station,f.managedUser,sibling,watch,randomUUID(),JSON.stringify({vendorId:f.vendor,ticketId:ticket})]);
    expect((await summary(f.officeSession)).firstWatch).toMatchObject({complete:true,action:null,context:{shiftId:sibling,watchId:watch,ticketId:ticket,eligibleUserId:f.managedUser,employeeId:null}});
  });
});
