import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({rows:[] as any[],claimed:[] as any[],exchange:vi.fn(),validate:vi.fn()}));
vi.mock("@workspace/db",()=>({db:{select:()=>({from:()=>({where:()=>({limit:async()=>m.rows})})}),update:()=>({set:()=>({where:()=>({returning:async()=>m.claimed})})})},workHubCalendarConnectionsTable:{id:"id",status:"status",createdById:"user",ownerOrgType:"type",ownerOrgId:"org",provider:"provider"},workHubSyncCursorsTable:{}}));
vi.mock("drizzle-orm",()=>({and:()=>null,eq:()=>null,like:()=>null,sql:()=>null}));
vi.mock("../../lib/accounting/crypto",()=>({decryptToken:(s:string)=>s,encryptToken:(s:string)=>s}));
vi.mock("../../assistant/chatgpt-grant-store",()=>({validateAssistantSession:m.validate}));
vi.mock("../teams-connection-service",()=>({teamsConnectionIdentity:(s:any)=>({binding:{userId:s.userId,membershipId:s.activeMembershipId,sessionVersion:s.sv,ownerType:"vendor",ownerId:s.vendorId}})}));
vi.mock("./providers",async()=>{const original=await vi.importActual<any>("./providers");return {...original,exchange:m.exchange};});
import {assertBinding,finish,withAccount} from "./accounts";
import {createHash} from "node:crypto";
const s={userId:1,activeMembershipId:2,sv:3,vendorId:4} as any;
const binding={userId:1,membershipId:2,sessionVersion:3,ownerType:"vendor",ownerId:4};
const state="123e4567-e89b-42d3-a456-426614174000."+"a".repeat(43);
beforeEach(()=>{m.rows=[];m.claimed=[];m.exchange.mockReset();m.validate.mockResolvedValue(s);});
it.each(["userId","membershipId","sessionVersion","ownerId"])("rejects credentials bound to another %s",field=>{expect(()=>assertBinding(s,{provider:"gmail",binding:{...binding,[field]:999}} as any)).toThrow("reconnect required");});
it("rejects replayed OAuth state before contacting a provider",async()=>{m.rows=[{status:"connected"}];await expect(finish("gmail",state,"code")).rejects.toThrow("invalid oauth state");expect(m.exchange).not.toHaveBeenCalled();});
it("rejects expired OAuth consent without exchanging a code",async()=>{m.rows=[{status:"pending",encryptedCredentials:JSON.stringify({provider:"gmail",binding,session:s,verifier:"v",stateHash:createHash("sha256").update(state).digest("hex"),expires:Date.now()-1})}];await expect(finish("gmail",state,"code")).rejects.toThrow("invalid oauth state");expect(m.exchange).not.toHaveBeenCalled();});
it("rejects a callback whose state nonce differs",async()=>{m.rows=[{status:"pending",encryptedCredentials:JSON.stringify({provider:"gmail",binding,session:s,verifier:"v",stateHash:"f".repeat(64),expires:Date.now()+10000})}];await expect(finish("gmail",state,"code")).rejects.toThrow("invalid oauth state");expect(m.exchange).not.toHaveBeenCalled();});

it("reads an unexpired private grant without a refresh transaction",async()=>{
 m.rows=[{status:"connected",encryptedCredentials:JSON.stringify({provider:"gmail",binding,label:"fixture",tokens:{access:"private-token",expires:Date.now()+300000}})}];
 const action=vi.fn().mockResolvedValue("ok");
 expect(await withAccount(s,"id",action)).toBe("ok");
 expect(action).toHaveBeenCalledWith("gmail","private-token","fixture");
 expect(m.exchange).not.toHaveBeenCalled();
});
it("never uses a revoked or differently bound grant on the read path",async()=>{
 const action=vi.fn();
 m.rows=[{status:"connected",revokedAt:new Date()}];
 await expect(withAccount(s,"id",action)).rejects.toThrow();
 m.rows=[{status:"connected",encryptedCredentials:JSON.stringify({provider:"gmail",binding:{...binding,userId:999},tokens:{access:"private-token",expires:Date.now()+300000}})}];
 await expect(withAccount(s,"id",action)).rejects.toThrow();
 expect(action).not.toHaveBeenCalled();
});
