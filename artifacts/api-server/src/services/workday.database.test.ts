import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { SessionPayload } from "../lib/session";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {buildTestCookie} from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
it("starts and ends only the confirmed assistant worker's current day with server time and exact receipt retries",async()=>{
 const f=await fixture(),operationId=randomUUID();
 const start={operationId,action:"start_shift",expectedShiftId:null,timezone:"America/Chicago"};
 const before=Date.now(),first=await f.service.recordAssistant(f.worker,start);expect(Date.parse(first.event.capturedAt)).toBeGreaterThanOrEqual(before);
 expect(await f.service.recordAssistant(f.worker,start)).toEqual(first);
 await expect(f.service.recordAssistant(f.worker,{...start,timezone:"UTC"})).rejects.toMatchObject({code:"workday.operation_conflict"});
 await expect(f.service.recordAssistant(f.office,{operationId:randomUUID(),action:"end_shift",expectedShiftId:first.shiftId,timezone:"America/Chicago"})).rejects.toMatchObject({code:"workday.current_shift_changed"});
 const ended=await f.service.recordAssistant(f.worker,{operationId:randomUUID(),action:"end_shift",expectedShiftId:first.shiftId,timezone:"America/Chicago"});expect(ended.summary.state).toBe("ended");expect((await f.service.current(f.worker)).workday).toBeNull();
 await expect(f.service.recordAssistant(f.worker,{...start,operationId:randomUUID(),capturedAt:"2000-01-01T00:00:00Z"})).rejects.toThrow();
});

async function fixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const mod = await import("./workday").catch(() => null);
  expect(mod, "shared workday mechanism exists").not.toBeNull();
  const {
    db,
    pool,
    vendorsTable,
    partnersTable,
    usersTable,
    userOrgMembershipsTable,
  } = await import("@workspace/db");
  const tag = randomUUID(),
    [vendor] = await db
      .insert(vendorsTable)
      .values({
        name: `Employer ${tag}`,
        contactName: "Synthetic",
        contactEmail: `${tag}@example.invalid`,
      })
      .returning(),
    [partner] = await db
      .insert(partnersTable)
      .values({
        name: `Partner employer ${tag}`,
        contactName: "Synthetic",
        contactEmail: `p-${tag}@example.invalid`,
      })
      .returning();
  const [worker, office, other] = await db
    .insert(usersTable)
    .values(
      ["Worker", "Office", "Other"].map((name) => ({
        username: `${name}-${tag}`,
        passwordHash: "not-a-login",
        displayName: name,
        role: "vendor",
      })),
    )
    .returning();
  const memberships = await db
    .insert(userOrgMembershipsTable)
    .values([
      {
        userId: worker.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "member",
      },
      {
        userId: office.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "admin",
      },
      {
        userId: other.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "member",
      },
      {
        userId: worker.id,
        orgType: "partner",
        partnerId: partner.id,
        role: "member",
      },
    ])
    .returning();
  const session = (
    person: typeof worker,
    member: (typeof memberships)[number],
  ): SessionPayload => ({
    userId: person.id,
    role: member.orgType === "vendor" ? "vendor" : "partner",
    sv: person.sessionVersion,
    activeMembershipId: member.id,
    membershipRole: member.role,
    vendorId: member.vendorId,
    partnerId: member.partnerId,
  });
  return {
    service: mod!.workdayService,
    pool,
    worker: session(worker, memberships[0]),
    office: session(office, memberships[1]),
    other: session(other, memberships[2]),
    partner: session(worker, memberships[3]),
  };
}
function command(
  session: SessionPayload,
  shiftId: string,
  action = "start_shift",
  capturedAt = "2026-10-15T12:00:00Z",
) {
  return {
    operationId: randomUUID(),
    shiftId,
    scope: {
      owner: {
        type: session.vendorId ? "vendor" : "partner",
        id: session.vendorId ?? session.partnerId,
      },
      userId: session.userId,
      membershipId: session.activeMembershipId,
      sessionVersion: session.sv,
    },
    action,
    capturedAt,
    timezone: "America/Chicago",
  };
}
it("shares one employee clock across portal entry points with exact retry/history and organization isolation", async () => {
  const f = await fixture(),
    shiftId = randomUUID(),
    start = command(f.worker, shiftId);
  const first = await f.service.record(f.worker, start);
  expect(first.summary.state).toBe("on_shift");
  expect(await f.service.record(f.worker, start)).toEqual(first);
  expect((await f.service.current(f.worker)).workday?.id).toBe(shiftId);
  expect((await f.service.read(f.office, shiftId)).events).toHaveLength(1);
  await expect(f.service.read(f.other, shiftId)).rejects.toMatchObject({
    status: 403,
  });
  await expect(f.service.read(f.partner, shiftId)).rejects.toMatchObject({
    status: 404,
  });
  expect((await f.service.current(f.partner)).workday).toBeNull();
  const ended = await f.service.record(
    f.worker,
    command(f.worker, shiftId, "end_shift", "2026-10-15T22:30:00Z"),
  );
  expect(ended.summary.reportedWorkMilliseconds).toBe(37800000);
  expect(ended.summary.payrollApproved).toBe(false);
  expect(await f.service.operation(f.worker, start.operationId)).toEqual(first);
  expect(
    (
      await f.service.list(f.office, f.worker.userId!, {
        start: "2026-10-15T00:00:00Z",
        end: "2026-10-16T00:00:00Z",
      })
    ).items,
  ).toHaveLength(1);
});
it("allows office employees to start their own day and prevents two independent starts, stale employer context or logout as a clock command", async () => {
  const f = await fixture(),
    start = command(f.office, randomUUID());
  const results = await Promise.allSettled([
    f.service.record(f.office, start),
    f.service.record(f.office, command(f.office, randomUUID())),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const current = await f.service.current(f.office);
  if (!current.workday) throw new Error("Expected the accepted workday");
  expect(current.workday.summary.state).toBe("on_shift");
  await expect(
    f.service.record(f.office, {
      ...command(f.office, current.workday.id),
      scope: {
        ...start.scope,
        owner: { type: "partner", id: f.office.vendorId },
      },
    }),
  ).rejects.toMatchObject({ code: "workday.original_scope_required" });
  await expect(
    f.service.record(f.office, {
      ...command(f.office, current.workday.id),
      action: "logout",
    }),
  ).rejects.toThrow();
  expect(
    (await f.service.current(f.office)).workday?.summary.endedAt,
  ).toBeNull();
});
it("exposes the same canonical workday through Fleet without writing a second portal clock", async () => {
  const f = await fixture(),
    shiftId = randomUUID();
  await f.service.record(f.worker, command(f.worker, shiftId));
  const { createFleetService } = await import("./fleet-ops"),
    { databaseFleetRepository } = await import("./fleet-repository");
  const fleet = createFleetService(databaseFleetRepository),
    actor = {
      userId: f.worker.userId!,
      companyId: f.worker.vendorId!,
      role: f.worker.role,
      sv: f.worker.sv,
      activeMembershipId: f.worker.activeMembershipId,
      membershipRole: f.worker.membershipRole,
    };
  const same = await fleet.workday(actor, shiftId);
  expect(same.id).toBe(shiftId);
  expect(same.events).toHaveLength(1);
  expect(same.summary.state).toBe("on_shift");
  const rows = await f.pool.query(
    "SELECT target_type FROM assistant_action_audit WHERE vendor_id=$1 AND target_id=$2 AND target_type IN ('workday','fleet-workday')",
    [actor.companyId, shiftId],
  );
  expect(rows.rows.map((row) => row.target_type)).toEqual(["workday"]);
});
it("serves the shared Work Hub mechanism with authenticated no-store reads and exact operation readback",async()=>{
 const f=await fixture(),module=await import("../routes/workday").catch(()=>null);expect(module,"shared Work Hub route exists").not.toBeNull();
 const app=express().use(express.json()).use(cookieParser()).use(module!.default),cookie=buildTestCookie(f.worker);
 expect((await request(app).get("/work-hub/workday")).status).toBe(401);
 const current=await request(app).get("/work-hub/workday").set("Cookie",cookie);expect(current.status).toBe(200);expect(current.body.workday).toBeNull();expect(current.headers["cache-control"]).toBe("no-store");
 const body=command(f.worker,randomUUID()),created=await request(app).post("/work-hub/workday/events").set("Cookie",cookie).send(body);expect(created.status).toBe(200);
 const read=await request(app).get(`/work-hub/workday/operations/${body.operationId}`).set("Cookie",cookie);expect(read.body).toEqual(created.body);
 const record=await request(app).get(`/work-hub/workday/shifts/${body.shiftId}`).set("Cookie",cookie);expect(record.body.events).toHaveLength(1);
 const ended=await request(app).post("/work-hub/workday/events").set("Cookie",cookie).send(command(f.worker,body.shiftId,"end_shift","2026-10-15T22:30:00Z"));expect(ended.status).toBe(200);
 const day=await request(app).get(`/work-hub/workday/workers/${f.worker.userId}?start=2026-10-15T00:00:00Z&end=2026-10-16T00:00:00Z`).set("Cookie",buildTestCookie(f.office));expect(day.status).toBe(200);expect(day.body.items).toHaveLength(1);
});

it("explicit workday controls synchronize shift tracking without changing separate consent or On Call",async()=>{
 const f=await fixture(),id=randomUUID();
 await f.pool.query("UPDATE vendors SET native_operations_policy=$2::jsonb WHERE id=$1",[f.worker.vendorId,JSON.stringify({enabled:true,dutyModes:["manual"]})]);
 await f.pool.query("INSERT INTO work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) VALUES($1,'vendor',$2,$3::jsonb)",[f.worker.userId,f.worker.vendorId,JSON.stringify({consent:{locationSharing:true,automaticArrival:false},designatedDeviceId:null,bindingVersion:1,duty:{active:false,mode:null,startedAt:null,endsAt:null,ticketId:null,shiftId:null,overrideEndedAt:null},onCallActive:true})]);
 await f.service.record(f.worker,command(f.worker,id));let value=(await f.pool.query("SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_id=$2",[f.worker.userId,f.worker.vendorId])).rows[0].native_operations;
 expect(value.duty.active).toBe(true);expect(value.consent.locationSharing).toBe(true);expect(value.onCallActive).toBe(true);
 await f.service.record(f.worker,command(f.worker,id,"end_shift","2026-10-15T22:30:00Z"));value=(await f.pool.query("SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_id=$2",[f.worker.userId,f.worker.vendorId])).rows[0].native_operations;expect(value.duty.active).toBe(false);expect(value.onCallActive).toBe(true);expect(value.consent.locationSharing).toBe(true);
});

it("retains an explicit office adjustment without rewriting the worker day or ending its clock",async()=>{
 const f=await fixture(),id=randomUUID();await f.service.record(f.worker,command(f.worker,id));
 const before=await f.service.read(f.office,id),input={operationId:randomUUID(),expectedVersion:before.version,adjustmentMinutes:"60",reason:"Verified yard preparation omitted from report"};
 const saved=await f.service.adjust(f.office,id,input);expect(saved.adjustmentMinutes).toBe("60");expect(saved.source).toBe("office_adjustment");
 expect(await f.service.adjust(f.office,id,input)).toEqual(saved);expect(await f.service.read(f.office,id)).toMatchObject({version:before.version,summary:before.summary});
 await expect(f.service.adjust(f.worker,id,{...input,operationId:randomUUID()})).rejects.toMatchObject({status:403});
 expect((await f.service.list(f.office,f.worker.userId!,{start:"2026-10-15T00:00:00Z",end:"2026-10-16T00:00:00Z"})).items[0].officeAdjustments).toEqual([saved]);
});

it("reauthorizes the same worker original shift scope without changing original times or allowing another membership",async()=>{
 const f=await fixture(),id=randomUUID(),original=command(f.worker,id);await f.service.record(f.worker,original);await f.pool.query("UPDATE users SET session_version=session_version+1 WHERE id=$1",[f.worker.userId]);const next={...f.worker,sv:f.worker.sv!+1},end={...original,operationId:randomUUID(),action:"end_shift",capturedAt:"2026-10-15T22:00:00Z"};
 await expect(f.service.record(next,end)).rejects.toMatchObject({status:403});await f.service.reauthorize(next,{scope:original.scope,reason:"Recover my original End of Day"});const receipt=await f.service.record(next,end);expect(receipt.event.capturedAt).toBe(end.capturedAt);expect(await f.service.record(next,end)).toEqual(receipt);await expect(f.service.reauthorize(f.office,{scope:original.scope,reason:"Cannot become other worker"})).rejects.toMatchObject({status:403});
});
