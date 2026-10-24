import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import express from "express";
import request from "supertest";
import {beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db,pool,usersTable,vendorsTable,partnersTable,siteLocationsTable,gateStationsTable,workHubShiftsTable,workHubShiftAssignmentsTable} from "@workspace/db";
import {assertFreshLocalTestDatabaseEnvironment} from "../../../../scripts/fresh-test-database.mjs";
import {coverageOwners} from "../work-hub/coverage-rules";
const state=vi.hoisted(()=>({session:{} as any,guard:vi.fn()}));
vi.mock("../lib/session",()=>({getSessionFromRequest:()=>state.session}));
vi.mock("../assistant/chatgpt-grant-store",()=>({validateAssistantSession:async(s:unknown)=>s}));
vi.mock("../work-hub/feature-access",()=>({isWorkHubEnabled:async()=>true}));
vi.mock("../services/gate-shift-assignment",async original=>({...await original<any>(),guardGateShiftAssignments:state.guard}));
import router from "./coverageWorkflow";
const app=express().use(express.json()).use(router);
describe("coverage persistence in a fresh isolated database",()=>{
 let vendorId:number,siteId:number,stationId:string,admin:number,original:number,replacement:number;
 const start="2099-10-25T06:00:00.000Z",end="2099-10-25T18:00:00.000Z";
 beforeAll(async()=>{
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const suffix=randomUUID();
  const [vendor]=await db.insert(vendorsTable).values({name:`Coverage ${suffix}`,contactName:"Fixture",contactEmail:`coverage.${suffix}@example.invalid`}).returning();vendorId=vendor.id;
  const [partner]=await db.insert(partnersTable).values({name:`Coverage ${suffix}`,contactName:"Fixture",contactEmail:`partner.${suffix}@example.invalid`}).returning();
  const [site]=await db.insert(siteLocationsTable).values({partnerId:partner.id,name:"Coverage fixture",address:"Fixture",latitude:30,longitude:-100,siteCode:`COV-${suffix}`}).returning();siteId=site.id;
  const [station]=await db.insert(gateStationsTable).values({siteId,name:"Coverage fixture gate"}).returning();stationId=station.id;
  const people=await db.insert(usersTable).values(["Admin","Original","Replacement"].map(name=>({username:`${name}.${suffix}@example.invalid`,email:`${name}.${suffix}@example.invalid`,displayName:name,passwordHash:"unused-test-hash",role:"vendor"}))).returning();
  [admin,original,replacement]=people.map(p=>p.id);
  const migration=await readFile(new URL("../../../../lib/db/drizzle/coverage_resolutions.sql",import.meta.url),"utf8");
  await pool.query(migration);await pool.query(migration);
 });
 beforeEach(()=>{state.session={userId:admin,vendorId,role:"vendor",membershipRole:"admin"};state.guard.mockReset().mockResolvedValue({});});
 async function shift(offset:number){
  const [s]=await db.insert(workHubShiftsTable).values({ownerOrgType:"vendor",ownerOrgId:vendorId,title:"Coverage fixture",startsAt:new Date(Date.parse(start)+offset*86400000),endsAt:new Date(Date.parse(end)+offset*86400000),timezone:"UTC",gateStationId:stationId,siteLocationId:siteId,requiredStaffCount:1,createdById:admin}).returning();
  await db.insert(workHubShiftAssignmentsTable).values({shiftId:s.id,userId:original,assignedById:admin});return s;
 }
 const body=(id:string,kind="temporary")=>({operationId:randomUUID(),owner:{type:"vendor",id:vendorId},context:{kind:"organization",id:vendorId},expectedVersion:null,payloadVersion:1,payload:{shiftId:id,expectedVersion:1,originalUserId:original,replacementUserId:replacement,kind,requestId:null}});
 async function assigned(id:string){return (await pool.query("SELECT user_id FROM work_hub_shift_assignments WHERE shift_id=$1 AND status='assigned' ORDER BY user_id",[id])).rows.map(r=>r.user_id);}
 it("saves a temporary exception once and preserves the next week's assignment",async()=>{
  const one=await shift(0),next=await shift(7),payload=body(one.id);
  expect((await request(app).post("/coverage-resolution").send(payload)).status).toBe(200);
  expect((await request(app).post("/coverage-resolution").send(payload)).status).toBe(200);
  expect(await assigned(one.id)).toEqual([replacement]);expect(await assigned(next.id)).toEqual([original]);
  const records=await pool.query("SELECT original_user_id,kind FROM workforce_coverage_resolutions WHERE anchor_shift_id=$1",[one.id]);expect(records.rows).toEqual([{original_user_id:original,kind:"temporary"}]);
 });
 it("rolls back earlier transfers if a later recurring occurrence conflicts",async()=>{
  const one=await shift(14),next=await shift(21);state.guard.mockResolvedValueOnce({}).mockRejectedValueOnce(Error("gate_assignment.policy_denied"));
  expect((await request(app).post("/coverage-resolution").send(body(one.id,"permanent"))).status).toBe(409);
  expect(await assigned(one.id)).toEqual([original]);expect(await assigned(next.id)).toEqual([original]);
  expect((await pool.query("SELECT id FROM workforce_coverage_resolutions WHERE anchor_shift_id=$1",[one.id])).rows).toHaveLength(0);
 });
 it("persists a permanent weekday owner and applies it to subsequent dates",async()=>{
  const one=await shift(28),next=await shift(35);
  expect((await request(app).post("/coverage-resolution").send(body(one.id,"permanent"))).status).toBe(200);
  expect(await assigned(one.id)).toEqual([replacement]);expect(await assigned(next.id)).toEqual([replacement]);
  expect(await coverageOwners(pool,{vendorId,stationId,startsAt:new Date(Date.parse(start)+42*86400000).toISOString(),endsAt:new Date(Date.parse(end)+42*86400000).toISOString(),timezone:"UTC",owners:[original],capacity:1})).toEqual([replacement]);
 });
});
