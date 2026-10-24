import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({ session: null as any, select: vi.fn(), execute: vi.fn(), guard: vi.fn(), lock: vi.fn(), query: vi.fn() }));
vi.mock("../services/gate-shift-assignment", () => ({ gateAssignmentTransactionClient: () => ({query:state.query}), guardGateShiftAssignments:state.guard,lockShiftSchedulingRows:state.lock }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => state.session }));
vi.mock("../assistant/chatgpt-grant-store",()=>({validateAssistantSession:async(s:unknown)=>s}));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("../work-hub/commands", () => ({ executeWorkHubCommand: state.execute }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: state.select }, siteLocationsTable: { id: "id", name: "name", partnerId: "partnerId" }, siteWorkAssignmentsTable: {},
  workforceStaffingRequirementsTable: { id: "id", ownerOrgType: "type", ownerOrgId: "owner", siteId: "site", roleCode: "role", retiredAt: "retired" },
  pool: {query:state.query}, workHubShiftsTable:{id:"id",ownerOrgType:"type",ownerOrgId:"owner",siteLocationId:"site"},workHubShiftAssignmentsTable:{shiftId:"shift",userId:"user"},
}));
import router from "./workHubSiteShiftPlans";
import { workHubShiftAssignmentsTable as assignments } from "@workspace/db";
const app = express().use(express.json()).use(router);
beforeEach(() => { state.session = null; state.select.mockReset(); state.execute.mockReset(); state.guard.mockReset(); state.lock.mockReset(); state.query.mockReset().mockResolvedValue({rows:[]}); });
describe("site shift plan access", () => {
  it("requires authentication before reading schedules", async () => {
    expect((await request(app).get("/work-hub/site-shift-plans?type=vendor&id=5")).status).toBe(401);
    expect(state.select).not.toHaveBeenCalled();
  });
  it("denies non-admin employees and supervisors", async () => {
    state.session = { userId: 1, role: "field_employee", vendorRole: "gate_supervisor", vendorId: 5 };
    expect((await request(app).get("/work-hub/site-shift-plans?type=vendor&id=5")).status).toBe(403);
    expect(state.select).not.toHaveBeenCalled();
  });
  it("does not let a company admin choose another company", async () => {
    state.session = { userId: 1, role: "vendor", membershipRole: "admin", vendorId: 5 };
    expect((await request(app).get("/work-hub/site-shift-plans?type=vendor&id=6")).status).toBe(403);
    expect(state.select).not.toHaveBeenCalled();
  });
  it("rejects a site outside the authorized company before reading its plan", async () => {
    state.session = { userId: 1, role: "vendor", membershipRole: "admin", vendorId: 5 };
    state.select.mockReturnValue({ from: () => ({ where: async () => [] }) });
    expect((await request(app).get("/work-hub/site-shift-plans/99?type=vendor&id=5")).status).toBe(403);
    expect(state.select).toHaveBeenCalledTimes(1);
  });
});
describe("assignment safety",()=>{
 describe("reviewed reassignments",()=>{
  const shiftId="33333333-3333-4333-8333-333333333333";
  const payload=(addUserId?:number)=>({operationId:"44444444-4444-4444-8444-444444444444",owner:{type:"vendor",id:5},context:{kind:"organization",id:5},expectedVersion:null,payloadVersion:1,payload:{changes:[{id:shiftId,version:1,removeUserId:7,...(addUserId ? {addUserId} : {})}]}});
  function prepare(version=1) {
   state.session={userId:1,role:"vendor",membershipRole:"admin",vendorId:5};
   state.select.mockReturnValue({from:()=>({where:async()=>[{id:9,name:"Site"}]})});
   let stored=[{userId:7,status:"assigned"},{userId:9,status:"assigned"}];
   const original=structuredClone(stored);
   const shift={id:shiftId,version,startsAt:new Date("2099-10-24T11:00:00Z"),endsAt:new Date("2099-10-24T23:00:00Z"),milestoneStatus:"upcoming",requiredStaffCount:2,recurrence:null};
   const updates=vi.fn();const inserts=vi.fn();
   const tx={select:vi.fn().mockReturnValueOnce({from:()=>({where:()=>({for:async()=>[shift]})})}).mockReturnValueOnce({from:()=>({where:async()=>stored})}),
    update:(table:unknown)=>({set:(patch:any)=>({where:async()=>{updates(table,patch);if(table===assignments)stored=stored.map(a=>a.userId===7?{...a,...patch}:a);}})}),
    insert:()=>({values:async(value:any)=>{inserts(value);stored.push({userId:value.userId,status:"assigned"});}})};
   state.execute.mockImplementation(async(_actor,_kind,_envelope,apply)=>{try{return {resource:await apply(tx)};}catch(error){stored=structuredClone(original);throw error;}});
   return {updates,inserts,rows:()=>stored};
  }
  it("transfers only the reviewed person and preserves other assignees",async()=>{
   const fake=prepare();expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(payload(8))).status).toBe(200);
   expect(fake.rows()).toEqual([{userId:7,status:"cancelled"},{userId:9,status:"assigned"},{userId:8,status:"assigned"}]);
   expect(state.guard.mock.calls.map(c=>c[3])).toEqual([[],[8]]);
  });
  it("supports reviewed removal without requiring a replacement",async()=>{
   const fake=prepare();expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(payload())).status).toBe(200);
   expect(fake.inserts).not.toHaveBeenCalled();expect(fake.rows()[1]).toEqual({userId:9,status:"assigned"});
  });
  it("rejects a stale transfer before any update",async()=>{
   const fake=prepare(2);expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(payload(8))).status).toBe(409);expect(fake.updates).not.toHaveBeenCalled();
  });
  it("propagates replacement failure so the transaction rolls back removal",async()=>{
   const fake=prepare();state.guard.mockImplementation(async(_c,_s,_id,users)=>{if(users.length)throw Error("gate_assignment.availability_required");});
   expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(payload(8))).status).toBe(422);
   expect(fake.rows()).toEqual([{userId:7,status:"assigned"},{userId:9,status:"assigned"}]);expect(fake.inserts).not.toHaveBeenCalled();
  });
 });
 const id="11111111-1111-4111-8111-111111111111";
 const envelope={operationId:"22222222-2222-4222-8222-222222222222",owner:{type:"vendor",id:5},context:{kind:"organization",id:5},expectedVersion:null,payloadVersion:1,payload:{userId:7,shifts:[{id,version:1}]}};
 function setup(assignees:any[]=[],version=1) {
  state.session={userId:1,role:"vendor",membershipRole:"admin",vendorId:5};
  state.select.mockReturnValue({from:()=>({where:async()=>[{id:9,name:"Site"}]})});
  const insert=vi.fn();
  const row={id,version,startsAt:new Date("2099-10-24T11:00:00Z"),endsAt:new Date("2099-10-24T23:00:00Z"),milestoneStatus:"upcoming",requiredStaffCount:1,recurrence:null};
  const tx={select:vi.fn().mockReturnValueOnce({from:()=>({where:()=>({for:async()=>[row]})})}).mockReturnValueOnce({from:()=>({where:async()=>assignees})}),insert};
  state.execute.mockImplementation(async(_actor,_kind,_envelope,apply)=>({resource:await apply(tx)}));
  return insert;
 }
 it("rejects stale versions before writing",async()=>{const insert=setup([],2);expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(envelope)).status).toBe(409);expect(insert).not.toHaveBeenCalled();});
 it("never replaces an existing assignee on a full shift",async()=>{const insert=setup([{userId:8,status:"assigned"}]);expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(envelope)).status).toBe(409);expect(insert).not.toHaveBeenCalled();});
 it("blocks overlapping commitments before eligibility or inserts",async()=>{const insert=setup();state.query.mockResolvedValue({rows:[{conflict:true}]});expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(envelope)).status).toBe(409);expect(state.lock).toHaveBeenCalled();expect(state.guard).not.toHaveBeenCalled();expect(insert).not.toHaveBeenCalled();});
 it("keeps canonical eligibility failures from writing",async()=>{const insert=setup();state.guard.mockRejectedValue(new Error("gate_assignment.availability_required"));expect((await request(app).post("/work-hub/site-shift-plans/9/assign").send(envelope)).status).toBe(422);expect(insert).not.toHaveBeenCalled();});
});
