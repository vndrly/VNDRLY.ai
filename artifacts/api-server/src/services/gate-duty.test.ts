import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import {workdayService} from "./workday";
import {startGateShift,prepareGateHandoff,appendGateShiftNote,transferGateShift,getShiftNotes,markShiftNoteViewed,assumeGateWatch,getGateWatchOperation,getChangeOverState,actOnShiftItem} from "./gate-change-over";
import {
  assumeGateDuty,
  endGateDuty,
  endWorkSession,
  getGateRoster,
  startWorkSession,
} from "./gate-duty";

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(policy: "on_site" | "paid_travel" = "on_site") {
  const key = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Gate Test','gate@example.invalid') RETURNING id",
      [`Duty partner ${key}`],
    )
  ).rows[0].id as number;
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Gate Test','gate@example.invalid') RETURNING id",
      [`Duty vendor ${key}`],
    )
  ).rows[0].id as number;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Duty site','Fixture',30,-100,$2) RETURNING id",
      [partner, key],
    )
  ).rows[0].id as number;
  const workType = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
      [`Duty ${key}`],
    )
  ).rows[0].id as number;
  await pool.query(
    "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",
    [site, workType, vendor],
  );
  const stationId = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id",
      [site, `Main gate ${key}`],
    )
  ).rows[0].id as string;

  const workers: SessionPayload[] = [];
  for (const suffix of ["bob", "chad", "sam"]) {
    const username = `duty-${suffix}-${randomUUID()}`;
    const userId = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,$2,'vendor',$3) RETURNING id",
        [username, await bcrypt.hash("fixture-password", 4), suffix],
      )
    ).rows[0].id as number;
    const personId = (
      await pool.query(
        "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper',$3,$4) RETURNING id",
        [vendor, userId, suffix, `${username}@example.invalid`],
      )
    ).rows[0].id as number;
    const membershipId = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id",
        [userId, vendor, personId],
      )
    ).rows[0].id as number;
    workers.push({
      userId,
      role: "vendor",
      vendorId: vendor,
      vendorRole: "gatekeeper",
      membershipRole: "member",
      activeMembershipId: membershipId,
      sv: 1,
    });
  }
  const shiftId = (
    await pool.query(
      `INSERT INTO work_hub_shifts(
        owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,
        site_location_id,gate_station_id,required_staff_count,work_start_policy,created_by_id
      ) VALUES('vendor',$1,$2,now()-interval '1 hour',now()+interval '11 hours','America/Chicago',$3,$4,2,$5,$6)
      RETURNING id`,
      [vendor, `Gate shift ${key}`, site, stationId, policy, workers[0]!.userId],
    )
  ).rows[0].id as string;
  await pool.query(
    "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status,assigned_by_id) VALUES($1,$2,'assigned',$2),($1,$3,'assigned',$2)",
    [shiftId, workers[0]!.userId, workers[1]!.userId],
  );
  return { site, vendor, stationId, shiftId, workers };
}

const key = () => randomUUID();

describe("Gate duty teams", () => {
  it("returns the latest ten filed notes and exact older notes with isolated, idempotent viewing", async () => {
    const f = await fixture(), author = f.workers[0]!, viewer = f.workers[1]!, other = f.workers[2]!;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const filed = new Date(Date.now() - (40 - i) * 86400000);
      const shift = (await pool.query("INSERT INTO gate_shifts(station_id,operator_id,started_at,ended_at) VALUES($1,$2,$3,$4) RETURNING id", [f.stationId, author.userId, new Date(+filed - 12 * 3600000), filed])).rows[0].id;
      const prep = (await pool.query("INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [shift, author.userId, JSON.stringify({openItems:[]}), `Historical note ${i}`, JSON.stringify({facts:[]}), filed])).rows[0].id;
      const incomingShift = (await pool.query("INSERT INTO gate_shifts(station_id,operator_id,started_at,ended_at) VALUES($1,$2,$3,$4) RETURNING id", [f.stationId, viewer.userId, filed, new Date(+filed + 12 * 3600000)])).rows[0].id;
      const id = key(); ids.push(id);
      await pool.query("INSERT INTO gate_handovers(id,preparation_id,incoming_shift_id,incoming_user_id,outgoing_name,incoming_name,acknowledged_at) VALUES($1,$2,$3,$4,'Author','Viewer',$5)", [id, prep, incomingShift, viewer.userId, filed]);
    }
    expect((await getShiftNotes(viewer, {stationId:f.stationId})).rows).toHaveLength(0);
    const recent = await getShiftNotes(viewer, {stationId:f.stationId,limit:10});
    expect(recent.rows.map(row=>row.id)).toEqual(ids.slice(2).reverse());
    expect(recent.rows[0]).toMatchObject({outgoing_user_id:author.userId,site_id:f.site,viewed_at:null});
    expect(recent.rows[0].filed_at).toBeTruthy();
    const before = await getShiftNotes(viewer,{stationId:f.stationId,handoffId:ids[0]});
    expect(before.rows.map(row=>row.id)).toEqual([ids[0]]);
    expect(before.rows[0].viewed_at).toBeNull();
    await markShiftNoteViewed(viewer,f.stationId,ids[0]!);
    await markShiftNoteViewed(viewer,f.stationId,ids[0]!);
    expect((await getShiftNotes(viewer,{stationId:f.stationId,handoffId:ids[0]})).rows[0].viewed_at).toBeTruthy();
    expect((await getShiftNotes(other,{stationId:f.stationId,handoffId:ids[0]})).rows[0].viewed_at).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM gate_shift_actions WHERE station_id=$1 AND kind='note_viewed'",[f.stationId])).rows[0].n).toBe(1);
    const anotherGate=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,'Another gate') RETURNING id",[f.site])).rows[0].id;
    await expect(markShiftNoteViewed(viewer,anotherGate,ids[0]!)).rejects.toMatchObject({status:404});
    await expect(getShiftNotes(viewer,{stationId:anotherGate,handoffId:ids[0]})).rejects.toMatchObject({status:404});
    const foreign = await fixture();
    await expect(markShiftNoteViewed(foreign.workers[0]!,f.stationId,ids[0]!)).rejects.toMatchObject({status:403});
    expect((await workdayService.current(viewer)).workday).toBeNull();
    expect((await pool.query("SELECT * FROM gate_shift_actions WHERE station_id=$1 AND kind IN ('open','resolve','reopen')",[f.stationId])).rowCount).toBe(0);
  });
  it("allows explicit assumption without a prepared handover, records it once, and preserves paid clocks and sessions", async () => {
    const f=await fixture(),outgoing=f.workers[0]!,incoming=f.workers[1]!;
    await startGateShift(outgoing,f.stationId);
    const before=await workdayService.current(outgoing),current=await getChangeOverState(incoming,f.stationId);
    const input={stationId:f.stationId,source:"web" as const,operationId:key(),expectedWatchId:current.shift!.id,preparationId:null,reviewedRevision:current.snapshot!.revision,acknowledged:true,allowUnprepared:true};
    const saved=await assumeGateWatch(incoming,input);
    expect((await getChangeOverState(incoming,f.stationId)).shift?.operator_id).toBe(incoming.userId);
    expect((await assumeGateWatch(incoming,input)).id).toBe(saved.id);
    expect((await getGateWatchOperation(incoming,f.stationId,input.operationId)).receipt.id).toBe(saved.id);
    const prep=(await pool.query("SELECT summary FROM gate_preparations WHERE id=$1",[input.operationId])).rows[0];
    expect(prep.summary.handoverPrepared).toBe(false);
    expect((await pool.query("SELECT id FROM gate_shift_actions WHERE station_id=$1 AND kind='assume_without_handoff'",[f.stationId])).rows).toHaveLength(1);
    expect((await workdayService.current(outgoing)).workday).toEqual(before.workday);
    expect((await workdayService.current(incoming)).workday).toBeNull();
    expect((await pool.query("SELECT session_version FROM users WHERE id=ANY($1::int[])",[[outgoing.userId,incoming.userId]])).rows.map(row=>row.session_version)).toEqual([1,1]);
  });
  it("rejects a changed watch, a newly prepared handover, and unacknowledged missing-handover assumption",async()=>{
    const f=await fixture(),outgoing=f.workers[0]!,incoming=f.workers[1]!;
    await assumeGateWatch(outgoing,{stationId:f.stationId,source:"web",operationId:key()});
    const current=await getChangeOverState(incoming,f.stationId);
    const input={stationId:f.stationId,source:"web" as const,operationId:key(),expectedWatchId:current.shift!.id,preparationId:null,reviewedRevision:current.snapshot!.revision,acknowledged:true,allowUnprepared:true};
    await expect(assumeGateWatch(incoming,{...input,expectedWatchId:null})).rejects.toMatchObject({code:"change_over.shift_changed"});
    await expect(assumeGateWatch(incoming,{...input,allowUnprepared:false})).rejects.toMatchObject({code:"change_over.acknowledgment_required"});
    await prepareGateHandoff(outgoing,f.stationId,"Saved after flyout opened",async facts=>({source:"facts",facts}));
    await expect(assumeGateWatch(incoming,input)).rejects.toMatchObject({code:"change_over.stale"});
    expect((await getChangeOverState(incoming,f.stationId)).shift?.operator_id).toBe(outgoing.userId);
  });
  it("lets a current supervisor amend the saved handoff without changing watch custody",async()=>{
    const f=await fixture(),outgoing=f.workers[0]!,other=f.workers[1]!,supervisor={...f.workers[2]!,vendorRole:"gate_supervisor"};
    await pool.query("UPDATE vendor_people SET vendor_role='gate_supervisor' WHERE user_id=$1 AND vendor_id=$2",[supervisor.userId,supervisor.vendorId]);
    await assumeGateWatch(outgoing,{stationId:f.stationId,source:"web",operationId:key()});
    const first=await prepareGateHandoff(outgoing,f.stationId,"Original notes",async facts=>({source:"facts",facts}));
    await expect(prepareGateHandoff(other,f.stationId,"Not allowed",async facts=>({source:"facts",facts}))).rejects.toMatchObject({status:403});
    const edited=await prepareGateHandoff(supervisor,f.stationId,"Revised by supervisor",async facts=>({source:"facts",facts}));
    expect(edited.id).not.toBe(first.id);expect(edited.notes).toBe("Revised by supervisor");
    expect((await pool.query("SELECT notes FROM gate_preparations WHERE id=$1",[first.id])).rows[0].notes).toBe("Original notes");
    expect((await getChangeOverState(outgoing,f.stationId)).shift?.operator_id).toBe(outgoing.userId);
    expect((await pool.query("SELECT actor_id FROM gate_shift_actions WHERE station_id=$1 AND kind='edit_handoff'",[f.stationId])).rows[0].actor_id).toBe(supervisor.userId);
  });
  it("appends concurrent new shift notes without losing prior notes or duplicating a retry",async()=>{
    const f=await fixture(),outgoing=f.workers[0]!,other=f.workers[1]!;
    await assumeGateWatch(outgoing,{stationId:f.stationId,source:"web",operationId:key()});
    const old=await prepareGateHandoff(outgoing,f.stationId,"Existing saved note",async facts=>({source:"facts",facts}));
    const watch=(await getChangeOverState(outgoing,f.stationId)).shift!;
    const input={stationId:f.stationId,expectedWatchId:watch.id,operationId:key(),text:"Delivery moved to east gate"};
    await expect(appendGateShiftNote(other,input)).rejects.toMatchObject({status:403});
    await Promise.all([appendGateShiftNote(outgoing,input),appendGateShiftNote(outgoing,{...input,operationId:key(),text:"Radio batteries charged"})]);
    await appendGateShiftNote(outgoing,input);
    const current=await getChangeOverState(outgoing,f.stationId);
    expect(current.preparation!.notes).toContain("Existing saved note");expect(current.preparation!.notes).toContain("Radio batteries charged");
    expect(current.preparation!.notes.split(input.text)).toHaveLength(2);expect(current.shift!.id).toBe(watch.id);
    expect((await pool.query("SELECT notes FROM gate_preparations WHERE id=$1",[old.id])).rows[0].notes).toBe("Existing saved note");
    expect((await pool.query("SELECT id FROM gate_shift_actions WHERE station_id=$1 AND kind='shift_note'",[f.stationId])).rows).toHaveLength(2);
  });
  it("keeps paid clocks and sessions unchanged while saving the exact acknowledged watch facts and original notes", async () => {
    const f = await fixture(), outgoing=f.workers[0]!, incoming=f.workers[1]!;
    await assumeGateWatch(outgoing,{stationId:f.stationId,source:"web",operationId:key()});
    expect((await workdayService.current(outgoing)).workday).toBeNull();
    const prep=await prepareGateHandoff(outgoing,f.stationId,"Original durable notes",async facts=>({source:"facts",facts}));
    await pool.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'open','Activity after preparation')",[f.stationId,outgoing.userId,key()]);
    const current=await getChangeOverState(incoming,f.stationId);
    expect(current.snapshot!.revision).not.toBe(prep.snapshot.revision);
    const input={stationId:f.stationId,source:"ios" as const,operationId:key(),preparationId:prep.id,reviewedRevision:current.snapshot!.revision,acknowledged:true};
    const saved=await assumeGateWatch(incoming,input);
    expect((await assumeGateWatch(incoming,input)).id).toBe(saved.id);
    expect((await getGateWatchOperation(incoming,f.stationId,input.operationId)).receipt.id).toBe(saved.id);
    const notes=await getShiftNotes(incoming,{stationId:f.stationId});
    expect(notes.rows[0].notes).toBe("Original durable notes");
    expect(notes.rows[0].snapshot.revision).toBe(current.snapshot!.revision);
    expect(JSON.stringify(notes.rows[0].snapshot)).toContain("Activity after preparation");
    const original=(await pool.query("SELECT snapshot FROM gate_preparations WHERE id=$1",[prep.id])).rows[0];
    expect(original.snapshot.revision).toBe(prep.snapshot.revision);
    expect((await workdayService.current(outgoing)).workday).toBeNull();
    expect((await workdayService.current(incoming)).workday).toBeNull();
    expect(await getGateRoster(incoming,f.stationId)).toMatchObject([{userId:incoming.userId}]);
    const versions=(await pool.query("SELECT session_version FROM users WHERE id=ANY($1::int[])",[[outgoing.userId,incoming.userId]])).rows;
    expect(versions.map(row=>row.session_version)).toEqual([1,1]);
    const other=(await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id",[f.site,key()])).rows[0].id;
    await expect(getGateWatchOperation(incoming,other,input.operationId)).rejects.toMatchObject({code:"change_over.operation_conflict"});
  });
  it("hands notes to the incoming watch and atomically switches both workers' shared clocks only after acknowledgement",async()=>{
    const f=await fixture(),outgoing=f.workers[0]!,incoming=f.workers[1]!;
    await startGateShift(outgoing,f.stationId);expect((await workdayService.current(outgoing)).workday).not.toBeNull();
    await assumeGateDuty(outgoing,{stationId:f.stationId,source:"ios",idempotencyKey:key()});
    const first=(await workdayService.current(outgoing)).workday!,prep=await prepareGateHandoff(outgoing,f.stationId,"Synthetic previous watch notes",async facts=>({source:"facts",facts}));
    const input={stationId:f.stationId,preparationId:prep.id,operationId:key(),revision:prep.snapshot.revision,acknowledged:false};
    await expect(transferGateShift(outgoing,incoming,input)).rejects.toMatchObject({code:"change_over.acknowledgment_required"});expect((await workdayService.current(outgoing)).workday?.id).toBe(first.id);expect((await workdayService.current(incoming)).workday).toBeNull();
    const saved=await transferGateShift(outgoing,incoming,{...input,acknowledged:true}),refreshed={...outgoing,sv:outgoing.sv!+1};
    const ended=await workdayService.read(refreshed,first.id),started=(await workdayService.current(incoming)).workday!;
    expect(ended.summary.endedAt).toBe(new Date(saved.acknowledged_at).toISOString());expect(started.summary.startedAt).toBe(ended.summary.endedAt);
    expect(ended.events.map(e=>e.kind)).toEqual(["start_shift","end_shift"]);expect((await workdayService.read(incoming,started.id)).events).toHaveLength(1);
    expect(await getGateRoster(incoming,f.stationId)).toMatchObject([{userId:incoming.userId}]);expect(JSON.stringify(await getShiftNotes(incoming,{stationId:f.stationId}))).toContain("Synthetic previous watch notes");
  });
  it("uses the shared duty clock for Assume Shift and completed Handoff without duplicate shifts",async()=>{
    const f=await fixture(),worker=f.workers[0]!,startedAt=new Date(Date.now()-3600000),operation=key();
    expect((await workdayService.current(worker)).workday).toBeNull();
    const duty=await assumeGateDuty(worker,{stationId:f.stationId,source:"ios",idempotencyKey:operation,at:startedAt});
    const first=(await workdayService.current(worker)).workday;expect(first?.summary.startedAt).toBe(startedAt.toISOString());
    await assumeGateDuty(worker,{stationId:f.stationId,source:"ios",idempotencyKey:operation,at:startedAt});expect((await workdayService.current(worker)).workday?.id).toBe(first!.id);
    await expect(endGateDuty(worker,{dutySessionId:duty.id,reason:"Shift notes not handed off",handoffCompleted:false})).rejects.toMatchObject({code:"change_over.handoff_required"});
    expect((await workdayService.current(worker)).workday?.id).toBe(first!.id);
    await endGateDuty(worker,{dutySessionId:duty.id,reason:"Roster sign off is not an acknowledged notes handoff",handoffCompleted:true});
    expect((await workdayService.current(worker)).workday?.id).toBe(first!.id);
    expect((await workdayService.read(worker,first!.id)).events.map(e=>e.kind)).toEqual(["start_shift"]);
  });
  it("binds Gate handoff to the original employer and never closes another company's day",async()=>{
    const f=await fixture(),worker=f.workers[0]!,incoming=f.workers[1]!;
    await assumeGateDuty(worker,{stationId:f.stationId,source:"ios",idempotencyKey:key()});
    const original=(await workdayService.current(worker)).workday!,prep=await prepareGateHandoff(worker,f.stationId,"Original employer notes",async facts=>({source:"facts",facts}));
    const otherVendor=(await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",[`Other employer ${key()}`])).rows[0].id;
    const membership=(await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",[worker.userId,otherVendor])).rows[0].id;
    const workType=(await pool.query("SELECT work_type_id FROM site_work_assignments WHERE site_location_id=$1 LIMIT 1",[f.site])).rows[0].work_type_id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",[f.site,workType,otherVendor]);
    const switched={...worker,vendorId:otherVendor,activeMembershipId:membership,membershipRole:"admin" as const},scope=(await workdayService.current(switched)).scope,otherId=key();
    await workdayService.record(switched,{operationId:key(),shiftId:otherId,scope,action:"start_shift",capturedAt:new Date().toISOString(),timezone:"America/Chicago"});
    await expect(transferGateShift(switched,incoming,{stationId:f.stationId,preparationId:prep.id,operationId:key(),revision:prep.snapshot.revision,acknowledged:true})).rejects.toMatchObject({code:"change_over.employer_context_changed"});
    expect((await workdayService.current(worker)).workday?.id).toBe(original.id);expect((await workdayService.current(switched)).workday?.id).toBe(otherId);
    expect(await getGateRoster(worker,f.stationId)).toMatchObject([{userId:worker.userId}]);
  });
  it("explicit Assume attaches a pre-update duty to today's shared clock without inventing historic hours",async()=>{
    const f=await fixture(),worker=f.workers[0]!,operation=key(),old=new Date(Date.now()-30*86400000);
    const legacy=(await pool.query("INSERT INTO gate_shifts(station_id,operator_id,started_at) VALUES($1,$2,$3) RETURNING id",[f.stationId,worker.userId,old])).rows[0];
    const duty=(await pool.query("INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage) VALUES($1,$2,$3,'ios',$4,$5::jsonb) RETURNING id",[f.stationId,worker.userId,old,operation,JSON.stringify({vendorId:f.vendor})])).rows[0];
    const before=Date.now();
    await assumeGateDuty(worker,{stationId:f.stationId,source:"ios",idempotencyKey:operation});
    const first=(await workdayService.current(worker)).workday!;expect(first).not.toBeNull();expect(Date.parse(first.summary.startedAt!)).toBeGreaterThanOrEqual(before);
    await assumeGateDuty(worker,{stationId:f.stationId,source:"ios",idempotencyKey:key()});expect((await workdayService.current(worker)).workday?.id).toBe(first.id);
    const proof=await pool.query("SELECT target_id FROM assistant_action_audit WHERE user_id=$1 AND target_type='gate-workday-binding'",[worker.userId]);expect(proof.rows).toHaveLength(2);
    expect(duty.id).not.toBe(legacy.id);
  });
  it("ends the replacement watch's own clock after roster operator replacement and actual notes handoff",async()=>{
    const f=await fixture(),first=f.workers[0]!,replacement=f.workers[1]!,incoming=f.workers[2]!;
    const firstDuty=await assumeGateDuty(first,{stationId:f.stationId,source:"ios",idempotencyKey:key()});
    await assumeGateDuty(replacement,{stationId:f.stationId,source:"ios",idempotencyKey:key()});
    const replacementClock=(await workdayService.current(replacement)).workday!;
    await endGateDuty(first,{dutySessionId:firstDuty.id,reason:"Roster departure only",handoffCompleted:false});
    expect((await workdayService.current(first)).workday).not.toBeNull();
    const prep=await prepareGateHandoff(replacement,f.stationId,"Replacement watch notes",async facts=>({source:"facts",facts}));
    await transferGateShift(replacement,incoming,{stationId:f.stationId,preparationId:prep.id,operationId:key(),revision:prep.snapshot.revision,acknowledged:true});
    const refreshed={...replacement,sv:replacement.sv!+1};expect((await workdayService.read(refreshed,replacementClock.id)).summary.endedAt).not.toBeNull();
    expect((await workdayService.current(incoming)).workday).not.toBeNull();
  });
  beforeAll(() => {
    if (process.env.VNDRLY_ISOLATED_TEST_DB !== "1") {
      throw new Error("Run Gate duty tests through the isolated database wrapper");
    }
  });

  it("allows two workers to assume one station and ends only the caller", async () => {
    const f = await fixture();
    const bob = await assumeGateDuty(f.workers[0]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "web",
      idempotencyKey: key(),
    });
    const chad = await assumeGateDuty(f.workers[1]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "ios",
      idempotencyKey: key(),
    });
    await endGateDuty(f.workers[0]!, {
      dutySessionId: bob.id,
      reason: "Relieved for appointment",
      handoffCompleted: false,
    });
    expect(await getGateRoster(f.workers[1]!, f.stationId)).toMatchObject([
      { id: chad.id, userId: f.workers[1]!.userId },
    ]);
  });
  it("rejects ending duty or work through a different station without closing either session", async () => {
    const f = await fixture();
    const work = await startWorkSession(f.workers[0]!, { stationId: f.stationId, workHubShiftId: f.shiftId, source: "web", idempotencyKey: key() });
    const duty = await assumeGateDuty(f.workers[0]!, { stationId: f.stationId, workSessionId: work.workSession.id, source: "web", idempotencyKey: key() });
    const wrongStation = key();
    await expect(endGateDuty(f.workers[0]!, { stationId: wrongStation, dutySessionId: duty.id, reason: "End shift", handoffCompleted: true })).rejects.toMatchObject({ code: "change_over.duty_not_found" });
    await expect(endWorkSession(f.workers[0]!, { stationId: wrongStation, workSessionId: work.workSession.id })).rejects.toMatchObject({ code: "change_over.work_session_not_found" });
    expect(await getGateRoster(f.workers[0]!, f.stationId)).toMatchObject([{ id: duty.id }]);
  });

  it("returns the same duty record for an idempotent retry", async () => {
    const f = await fixture();
    const idempotencyKey = key();
    const input = {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "askv" as const,
      idempotencyKey,
    };
    const first = await assumeGateDuty(f.workers[0]!, input);
    const retry = await assumeGateDuty(f.workers[0]!, input);
    expect(retry.id).toBe(first.id);
  });

  it("rejects a worker who is not assigned to the selected Work Hub shift", async () => {
    const f = await fixture();
    await expect(
      assumeGateDuty(f.workers[2]!, {
        stationId: f.stationId,
        workHubShiftId: f.shiftId,
        source: "web",
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "change_over.assignment_required" });
  });

  it("starts on-site work and duty together", async () => {
    const f = await fixture("on_site");
    const result = await startWorkSession(f.workers[0]!, {
      workHubShiftId: f.shiftId,
      stationId: f.stationId,
      source: "ios",
      idempotencyKey: key(),
    });
    expect(result.workSession.startPolicy).toBe("on_site");
    expect(result.dutySession).toMatchObject({ stationId: f.stationId });
  });

  it("starts paid travel without putting the worker on gate duty", async () => {
    const f = await fixture("paid_travel");
    const result = await startWorkSession(f.workers[0]!, {
      workHubShiftId: f.shiftId,
      stationId: f.stationId,
      source: "ios",
      idempotencyKey: key(),
      locationSharingActive: true,
    });
    expect(result.workSession).toMatchObject({
      startPolicy: "paid_travel",
      travelStatus: "en_route",
      locationSharingActive: true,
    });
    expect(result.dutySession).toBeNull();
  });

  it("requires a completed handoff when the last worker leaves", async () => {
    const f = await fixture();
    const duty = await assumeGateDuty(f.workers[0]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "web",
      idempotencyKey: key(),
    });
    await expect(
      endGateDuty(f.workers[0]!, {
        dutySessionId: duty.id,
        reason: "Shift ended",
        handoffCompleted: false,
      }),
    ).rejects.toMatchObject({ code: "change_over.handoff_required" });
    await expect(
      endGateDuty(f.workers[0]!, {
        dutySessionId: duty.id,
        reason: "Shift ended",
        handoffCompleted: true,
      }),
    ).resolves.toMatchObject({ id: duty.id });
  });
});
