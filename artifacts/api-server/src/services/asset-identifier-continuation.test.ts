import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock("./asset-hold-release", () => ({ authorizeAssetHoldRelease: async () => { if (!auth.allowed) throw Object.assign(new Error("revoked"), { code: "asset.current_session_required" }); } }));
import { createAssetIdentifierClaimService } from "./asset-identifier-claims";
const assetId=randomUUID(),claimId=randomUUID(),foreignAssetId=randomUUID();
const session={userId:1,sv:1,role:"vendor",vendorId:7,activeMembershipId:2,membershipRole:"admin"};
function database(status="awaiting_evidence",owner=7) {
 const initial={id:claimId,assetId,alias:{kind:"serial",value:"EXACT"},status,version:2,operationId:randomUUID(),submittedAt:"2026-10-07T00:00:00Z",reviewedAt:"2026-10-07T01:00:00Z",reason:"initial claim",reviewReason:"Please explain",requesterOwner:{type:"vendor",id:owner},existingAssetId:foreignAssetId,assetVersion:1,ownershipTransferred:false,otherOwnerDisclosed:false};
 const audits:any[]=[];
 const query=vi.fn(async(sql:string,args:any[]=[]):Promise<{rows:any[]}>=>{
  if(sql.startsWith("SELECT * FROM assets"))return{rows:[{id:assetId,version:1,status:"available",responsible_org_type:"vendor",responsible_org_id:7}]};
  if(sql.startsWith("SELECT DISTINCT ON(target_id) tool_output")&&!sql.includes("existingAssetId"))return{rows:[{tool_output:audits.at(-1)?.tool_output??initial}]};
  if(sql.startsWith("SELECT tool_output FROM assistant_action_audit"))return{rows:args[0]===claimId?[{tool_output:audits.at(-1)?.tool_output??initial}]:[]};
  if(sql.startsWith("SELECT user_id,tool_input"))return{rows:audits.filter(x=>x.tool_input.operationId===args[0])};
  if(sql.startsWith("INSERT INTO assistant_action_audit"))audits.push({user_id:args[0],tool_input:JSON.parse(args[3]),tool_output:JSON.parse(args[4])});
  return{rows:[]};
 });
 return {pool:{connect:async()=>({query,release:vi.fn()})} as unknown as Pick<Pool,"connect">,query,audits};
}
beforeEach(()=>auth.allowed=true);
describe("requester claim continuation",()=>{
 it("records one actual explanation, hides foreign identity and preserves alias/custody on exact replay",async()=>{
  const db=database(),service=createAssetIdentifierClaimService(db.pool),input={operationId:randomUUID(),expectedVersion:2,reason:"I can describe the registration history",confirmed:true};
  const first=await service.continueClaim(session,assetId,claimId,"respond",input);
  expect(first).toMatchObject({status:"pending_review",version:3,responseReason:input.reason,reason:"initial claim",reviewReason:"Please explain",physicalEvidenceVerified:false});
  expect(JSON.stringify(first)).not.toContain(foreignAssetId);expect(first).not.toHaveProperty("requesterOwner");
  expect(await service.continueClaim(session,assetId,claimId,"respond",input)).toEqual(first);expect(db.audits).toHaveLength(1);
  expect(db.query.mock.calls.some(([sql])=>/UPDATE assets|INSERT INTO asset_aliases|asset_custody_events/.test(sql))).toBe(false);
  auth.allowed=false;await expect(service.continueClaim(session,assetId,claimId,"respond",input)).rejects.toMatchObject({code:"asset.current_session_required"});expect(db.audits).toHaveLength(1);
 });
 it("withdraws an open claim terminally but retains exact replay and original history",async()=>{
  const db=database("pending_review"),service=createAssetIdentifierClaimService(db.pool),input={operationId:randomUUID(),expectedVersion:2,reason:"I withdraw my registration claim",confirmed:true};
  const result=await service.continueClaim(session,assetId,claimId,"withdraw",input);expect(result).toMatchObject({status:"withdrawn",version:3,ownershipTransferred:false});expect(result.withdrawnAt).toBeTruthy();
  expect(await service.continueClaim(session,assetId,claimId,"withdraw",input)).toEqual(result);
  await expect(service.continueClaim(session,assetId,claimId,"respond",{...input,operationId:randomUUID(),expectedVersion:3})).rejects.toMatchObject({code:"asset.claim_terminal"});expect(db.audits).toHaveLength(1);
 });
 it("refuses stale versions, wrong statuses, changed operation payload and evidence-path injection",async()=>{
  const db=database(),service=createAssetIdentifierClaimService(db.pool),input={operationId:randomUUID(),expectedVersion:2,reason:"Actual explanation",confirmed:true};
  await expect(service.continueClaim(session,assetId,claimId,"respond",{...input,expectedVersion:1})).rejects.toMatchObject({code:"asset.version_conflict"});
  await expect(service.continueClaim(session,assetId,claimId,"respond",{...input,attachmentPaths:["/objects/uploads/unverified"]})).rejects.toThrow();
  await service.continueClaim(session,assetId,claimId,"respond",input);
  await expect(service.continueClaim(session,assetId,claimId,"respond",{...input,reason:"Changed"})).rejects.toMatchObject({code:"asset.operation_reused"});
  await expect(service.continueClaim(session,assetId,claimId,"respond",{...input,operationId:randomUUID(),expectedVersion:3})).rejects.toMatchObject({code:"asset.claim_terminal"});expect(db.audits).toHaveLength(1);
 });
 it("denies platform impersonation, other company claims and mismatched claim IDs",async()=>{
  const db=database(),service=createAssetIdentifierClaimService(db.pool),input={operationId:randomUUID(),expectedVersion:2,reason:"explanation",confirmed:true};
  await expect(service.continueClaim({...session,role:"admin"},assetId,claimId,"respond",input)).rejects.toMatchObject({code:"asset.not_found"});
  await expect(service.continueClaim({...session,vendorId:8},assetId,claimId,"respond",input)).rejects.toMatchObject({code:"asset.not_found"});
  await expect(service.continueClaim(session,assetId,randomUUID(),"respond",input)).rejects.toMatchObject({code:"asset.claim_not_found"});
  const foreign=database("awaiting_evidence",8);await expect(createAssetIdentifierClaimService(foreign.pool).continueClaim(session,assetId,claimId,"respond",input)).rejects.toMatchObject({code:"asset.claim_not_found"});expect(db.audits).toHaveLength(0);
 });
});

it("projects current requester controls only for authorized own open claims",async()=>{
 for(const [status,expected]of [["awaiting_evidence",["respond","withdraw"]],["pending_review",["withdraw"]],["withdrawn",[]]] as const){
  const service=createAssetIdentifierClaimService(database(status).pool);
  expect((await service.list(session,assetId)).claims[0].requesterActions).toEqual(expected);
  expect((await service.list({...session,role:"admin"},assetId)).claims[0].requesterActions).toEqual([]);
 }
});
