import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({query:vi.fn(),access:vi.fn(),manage:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:mocks.query}}));
vi.mock("./gate-change-over",()=>({
  ChangeOverError:class extends Error {constructor(public status:number,public code:string,message:string){super(message);}},
  requireChangeOverAccess:mocks.access, requireGateStationManagementAccess:mocks.manage,
  changeOverTransaction:async (work:any)=>work({query:mocks.query}),
}));
import { gateConnectionHeartbeat, linkedGateScope, saveGateSiteLink } from "./gate-links";
const actor = {userId:7,role:"vendor" as const,vendorId:2,sv:1};
beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({});mocks.manage.mockResolvedValue(undefined);});
it("keeps an unlinked site's roster unchanged",async()=>{
  mocks.query.mockResolvedValue({rows:[{id:10,partner_id:1,gate_link_id:null}]});
  expect(await linkedGateScope({query:mocks.query},actor,10)).toEqual({siteIds:[10],groupId:null,name:null});
});
it("shares only linked sites the current operator may read",async()=>{
  mocks.query.mockImplementation(async(sql:string)=>sql.includes("WHERE id=$1")?{rows:[{id:10,partner_id:1,gate_link_id:"group",gate_link_name:"North Spur"}]}:{rows:[{id:10},{id:20},{id:30}]});
  const {ChangeOverError} = await import("./gate-change-over");
  mocks.access.mockImplementation(async(_c:any,_s:any,id:number)=>{if(id===30)throw new ChangeOverError(403,"forbidden","No site access");return {};});
  mocks.manage.mockRejectedValue(new ChangeOverError(403,"forbidden","No management access"));
  expect((await linkedGateScope({query:mocks.query},actor,10)).siteIds).toEqual([10,20]);
  expect(mocks.access).toHaveBeenCalledTimes(3);
});
it("rejects cross-partner links without changing either site",async()=>{
  mocks.query.mockResolvedValue({rows:[{id:10,partner_id:1},{id:20,partner_id:2}]});
  await expect(saveGateSiteLink(actor,{siteId:10,targetSiteId:20,name:"Spur"})).rejects.toMatchObject({status:400});
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
});
it("requires management authority at both linked sites",async()=>{
  mocks.manage.mockRejectedValueOnce(Object.assign(Error("Forbidden"),{status:403}));
  await expect(saveGateSiteLink(actor,{siteId:10,targetSiteId:20})).rejects.toMatchObject({status:403});
  expect(mocks.query).not.toHaveBeenCalled();
});
it("never silently merges existing parallel groups",async()=>{
  mocks.query.mockResolvedValue({rows:[{id:10,partner_id:1,gate_link_id:"a"},{id:20,partner_id:1,gate_link_id:"b"}]});
  await expect(saveGateSiteLink(actor,{siteId:10,targetSiteId:20})).rejects.toMatchObject({status:409});
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
});
it("joins the existing group and preserves its name",async()=>{
  mocks.query.mockImplementation(async(sql:string)=>sql.startsWith("SELECT")?{rows:[{id:10,partner_id:1},{id:20,partner_id:1,gate_link_id:"existing",gate_link_name:"North Spur"}]}:{rows:[],rowCount:2});
  expect(await saveGateSiteLink(actor,{siteId:10,targetSiteId:20})).toEqual({groupId:"existing",name:"North Spur"});
  expect(mocks.manage).toHaveBeenCalledWith(expect.anything(),actor,20);
  expect(mocks.query.mock.calls.at(-1)![1]).toEqual([[10,20],"existing","North Spur"]);
});
it("does not report an office viewer as a connected booth",async()=>{
  mocks.query.mockImplementation(async(sql:string)=>sql.startsWith("SELECT")?{rows:[{site_id:10}]}:{rows:[],rowCount:0});
  expect(await gateConnectionHeartbeat(actor,"gate")).toEqual({recorded:false});
  const sql=mocks.query.mock.calls.at(-1)![0];
  expect(sql).toContain("operator_id=$2");expect(sql).toContain("ended_at IS NULL");
  expect(mocks.query.mock.calls.at(-1)![1]).toEqual(["gate",7,1]);
});
it("keeps public demo links and connection reports read only",async()=>{
  const demo={...actor,publicDemo:true};
  await expect(saveGateSiteLink(demo,{siteId:10,targetSiteId:20})).rejects.toMatchObject({status:403});
  await expect(gateConnectionHeartbeat(demo,"gate")).rejects.toMatchObject({status:403});
  expect(mocks.query).not.toHaveBeenCalled();
});
