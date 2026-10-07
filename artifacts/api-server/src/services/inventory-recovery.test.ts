import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ allowed: true, calls: 0 }));
vi.mock("./asset-hold-release", () => ({ authorizeAssetHoldRelease: async () => { auth.calls++; if (!auth.allowed) throw Object.assign(new Error("revoked"), { code: "asset.current_session_required" }); } }));
import { createAssetLossReportService } from "./asset-loss-report";
import { createAssetIdentifierClaimService } from "./asset-identifier-claims";
const assetId="10000000-0000-4000-8000-000000000001", otherAssetId="20000000-0000-4000-8000-000000000002";
const session={userId:1,sv:1,role:"vendor",vendorId:7,activeMembershipId:2,membershipRole:"admin"};
function database() {
  let version=1, holds=0; const events: Record<string,unknown>[]=[]; const audits: {user_id:number;tool_input:any;tool_output:any}[]=[];
  const query=vi.fn(async(sql:string,parameters:any[]=[]):Promise<{rows:any[]}>=>{
    if(sql.startsWith("SELECT * FROM assets"))return{rows:[{id:assetId,version,status:"checked_out",current_holder_user_id:1,responsible_org_type:"vendor",responsible_org_id:7}]};
    if(sql.startsWith("SELECT * FROM asset_custody_events"))return{rows:events.filter(row=>row.operation_id===parameters[0])};
    if(sql.startsWith("INSERT INTO asset_custody_events")){const event={operation_id:parameters[0],asset_id:parameters[1],event_type:"condition",actor_user_id:parameters[2],from_holder_user_id:parameters[3],condition:parameters[4],asset_version:parameters[6],command_fingerprint:parameters[7],occurred_at:new Date("2026-10-07T00:00:00Z")};events.push(event);return{rows:[event]};}
    if(sql.startsWith("INSERT INTO asset_holds"))holds++;
    if(sql.startsWith("UPDATE assets SET status"))version=parameters[0];
    if(sql.startsWith("SELECT a.id"))return{rows:[{id:otherAssetId,responsible_org_type:"vendor",responsible_org_id:99}]};
    if(sql.startsWith("SELECT user_id,tool_input"))return{rows:audits.filter(row=>row.tool_input.operationId===parameters[0]).slice(-1)};
    if(sql.startsWith("INSERT INTO assistant_action_audit")){audits.push({user_id:parameters[0],tool_input:JSON.parse(parameters[3]),tool_output:JSON.parse(parameters[4])});}
    if(sql.startsWith("SELECT DISTINCT m.user_id"))return{rows:[{user_id:999}]};
    if(sql.startsWith("SELECT role FROM users"))return{rows:[{role:"vendor"}]};
    return{rows:[]};
  });
  return{pool:{connect:async()=>({query,release:vi.fn()})} as unknown as Pick<Pool,"connect">,query,events,audits,holds:()=>holds};
}
beforeEach(()=>{auth.allowed=true;auth.calls=0;});
describe("Inventory recovery truthful persistence",()=>{
  it("retains custody, creates one hold/event and returns original exact replay only after current authorization",async()=>{
    const db=database(),service=createAssetLossReportService(db.pool),input={operationId:randomUUID(),expectedVersion:1,condition:"stolen",reason:"Actual user report",confirmed:true};
    const first=await service.report(session,assetId,input),replay=await service.report(session,assetId,input);
    expect(replay).toEqual(first);expect(first).toMatchObject({holderUserId:1,version:2,physicalLossVerified:false});expect(db.events).toHaveLength(1);expect(db.holds()).toBe(1);
    expect(db.query.mock.calls.some(([sql])=>sql.includes("SET current_holder"))).toBe(false);
    auth.allowed=false;await expect(service.report(session,assetId,input)).rejects.toMatchObject({code:"asset.current_session_required"});expect(auth.calls).toBe(3);expect(db.events).toHaveLength(1);
  });
  it("refuses changed payload reuse and stale version before another hold or event",async()=>{
    const db=database(),service=createAssetLossReportService(db.pool),input={operationId:randomUUID(),expectedVersion:1,condition:"missing",reason:"Actual report",confirmed:true};
    await service.report(session,assetId,input);
    await expect(service.report(session,assetId,{...input,reason:"changed"})).rejects.toMatchObject({code:"asset.operation_reused"});
    await expect(service.report(session,assetId,{...input,operationId:randomUUID()})).rejects.toMatchObject({code:"asset.version_conflict"});expect(db.holds()).toBe(1);
  });
  it("projects only requester claim and emits no second notice on exact replay",async()=>{
    const db=database(),service=createAssetIdentifierClaimService(db.pool),input={operationId:randomUUID(),claimId:randomUUID(),expectedVersion:1,alias:{kind:"serial",value:"ACTUAL"},reason:"Actual registration collision",confirmed:true};
    const result=await service.submit(session,assetId,input);
    expect(result.claim).toMatchObject({status:"pending_review",ownershipTransferred:false,otherOwnerDisclosed:false});expect(JSON.stringify(result.claim)).not.toContain(otherAssetId);expect((result.claim as any).requesterOwner).toBeUndefined();
    expect(result.notice?.userIds).toEqual([999]);expect((await service.submit(session,assetId,input)).notice).toBeNull();expect(db.audits).toHaveLength(1);
    await expect(service.resolve(session,assetId,input.claimId,{operationId:randomUUID(),expectedVersion:1,decision:"retain_existing",reason:"review",confirmed:true})).rejects.toMatchObject({code:"asset.mediator_required"});expect(db.audits).toHaveLength(1);
  });
});
