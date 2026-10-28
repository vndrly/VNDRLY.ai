import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ selections: [] as unknown[][], updates: [] as unknown[][], exchanged: vi.fn(), refreshed: vi.fn(), profile: vi.fn(), insertValues: vi.fn(), updateValues: vi.fn(),updateWhere:vi.fn() }));
vi.mock("drizzle-orm", () => ({ and: (...v:unknown[])=>v, eq: (a:unknown,b:unknown)=>({a,b}), isNull:(a:unknown)=>({null:a}),like:(a:unknown,b:unknown)=>({like:a,pattern:b}),notLike:(a:unknown,b:unknown)=>({notLike:a,pattern:b}) }));
vi.mock("@workspace/db", () => {
  const update=()=>({set:(v:unknown)=>{mocks.updateValues(v);return {where:(where:unknown)=>{mocks.updateWhere(where);return {returning:async()=>mocks.updates.shift()||[]};}};}});
  return {
  workHubCalendarConnectionsTable: { ownerOrgType:"orgType",ownerOrgId:"orgId",provider:"provider",createdById:"creator",id:"id",status:"status",revokedAt:"revokedAt",encryptedCredentials:"credentials" },
  workHubSyncCursorsTable: { connectionId:"connectionId",resourceType:"resourceType",id:"id",cursor:"cursor" },
  db: {
    select: () => ({from:()=>({where:()=>({limit:async()=>mocks.selections.shift()||[]})})}),
    insert:()=>({values:(v:unknown)=>{mocks.insertValues(v);return {onConflictDoNothing:async()=>[]};}}),
    update,
    transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({update}),
  },
};});
vi.mock("../lib/accounting/crypto",()=>({encryptToken:(s:string)=>s,decryptToken:(s:string)=>s}));
vi.mock("./teams-graph",async(importOriginal)=>({ ...await importOriginal<typeof import("./teams-graph")>(),loadTeamsConfig:()=>({clientId:"client",clientSecret:"secret",tenantId:"organizations",redirectUri:"https://vndrly.ai/api/work-hub/teams/callback"}),exchangeTeamsCode:mocks.exchanged,refreshTeamsToken:mocks.refreshed,getTeamsProfile:mocks.profile }));
import { TeamsProviderError } from "./teams-graph";
import { assertTeamsGeneration, connectStart, disconnect, finishConnect, getTeamsConnection, status, teamsConnectionIdentity, withTeamsToken } from "./teams-connection-service";
const session={userId:7,vendorId:9,activeMembershipId:12,sv:3};
const binding={userId:7,membershipId:12,sessionVersion:3,ownerType:"vendor",ownerId:9};
const tokens={accessToken:"private-access",refreshToken:"private-refresh",expiresIn:3600,scope:"User.Read Calendars.ReadWrite Chat.Read ChatMessage.Send",tenantId:"11111111-1111-1111-1111-111111111111"};
function row(overrides:Record<string,unknown>={}) {return {id:"connection",ownerOrgType:"vendor",ownerOrgId:9,provider:"microsoft_teams:7:12",createdById:7,status:"connected",revokedAt:null,encryptedCredentials:JSON.stringify({kind:"teams_connection_v1",binding,tokens,expiresAt:Date.now()+3600000,account:{id:"object",displayName:"V",userPrincipalName:"v@vndrly.ai",mail:null,username:"v@vndrly.ai"},tenantId:tokens.tenantId,generation:"g"}),...overrides};}
beforeEach(()=>{mocks.selections.length=0;mocks.updates.length=0;vi.clearAllMocks();mocks.exchanged.mockResolvedValue(tokens);mocks.refreshed.mockResolvedValue(tokens);mocks.profile.mockResolvedValue({id:"object",displayName:"V",userPrincipalName:"v@vndrly.ai",mail:null});});
afterEach(()=>vi.restoreAllMocks());
describe("Teams account boundaries",()=>{
  it("derives owner/provider from active membership and rejects demo or missing org",()=>{
    expect(teamsConnectionIdentity(session)).toMatchObject({provider:"microsoft_teams:7:12",binding});
    expect(()=>teamsConnectionIdentity({userId:7,role:"admin"})).toThrow("teams_organization_required");
    expect(()=>teamsConnectionIdentity({...session,realm:"demo"})).toThrow("teams_connection_forbidden");
  });
  it("rejects encrypted credentials from another membership or session version",async()=>{
    mocks.selections.push([row()]);
    await expect(getTeamsConnection({...session,activeMembershipId:13})).rejects.toThrow("teams_reconnect_required");
    mocks.selections.push([row()]);
    await expect(getTeamsConnection({...session,sv:4})).rejects.toThrow("teams_reconnect_required");
  });
  it("returns account metadata without exposing credentials",async()=>{
    mocks.selections.push([row()]);const result=await status(session);
    expect(result).toMatchObject({connected:true,account:{username:"v@vndrly.ai"}});
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("rejects stale UI generation instead of mutating the newly connected account",async()=>{
    const current=row();
    current.encryptedCredentials=JSON.stringify({...JSON.parse(current.encryptedCredentials),generation:"1".repeat(64)});
    const verified=current as NonNullable<Awaited<ReturnType<typeof getTeamsConnection>>>;
    expect(()=>assertTeamsGeneration(session,verified,"2".repeat(64))).toThrow("teams_account_changed");
    expect(()=>assertTeamsGeneration(session,verified,"1".repeat(64))).not.toThrow();
    expect(()=>assertTeamsGeneration(session,verified,"")).toThrow("teams_account_changed");
  });
  it("consumes OAuth state once before exchange and binds account/tenant",async()=>{
    const connection=row();mocks.selections.push([connection]);
    const started=await connectStart(session);const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    const pending=mocks.insertValues.mock.calls[1][0];
    mocks.selections.push([connection],[{id:"cursor",cursor:pending.cursor}]);mocks.updates.push([{id:"cursor"}],[{id:"connection"}]);
    expect(await finishConnect(session,state,"code")).toMatchObject({connected:true,account:{username:"v@vndrly.ai"}});
    mocks.selections.push([connection],[{id:"cursor",cursor:null}]);
    await expect(finishConnect(session,state,"code")).rejects.toThrow("teams_invalid_oauth_state");
    expect(mocks.exchanged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.updateValues.mock.calls[1][0].encryptedCredentials)).toMatchObject({tenantId:tokens.tenantId,binding});
  });
  it("never invokes caller with a token after a racing revocation",async()=>{
    const expired=row({encryptedCredentials:JSON.stringify({...JSON.parse(row().encryptedCredentials),expiresAt:1})});
    mocks.selections.push([expired],[row({status:"revoked",revokedAt:new Date()})]);mocks.updates.push([]);
    const caller=vi.fn();await expect(withTeamsToken(session,caller)).rejects.toThrow("teams_not_connected");expect(caller).not.toHaveBeenCalled();
  });
  it("requires disconnect before changing the Microsoft principal",async()=>{
    const connection=row();mocks.selections.push([connection]);
    const started=await connectStart(session);const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    const pending=mocks.insertValues.mock.calls[1][0];
    mocks.selections.push([connection],[{id:"cursor",cursor:pending.cursor}]);mocks.updates.push([{id:"cursor"}]);
    mocks.profile.mockResolvedValue({id:"different-object",displayName:"Other",userPrincipalName:"other@example.com",mail:null});
    await expect(finishConnect(session,state,"code")).rejects.toThrow("teams_disconnect_before_account_switch");
    expect(mocks.updateValues).toHaveBeenCalledTimes(1);
  });
  it("invalidates external mappings only for a deliberate account switch after disconnect",async()=>{
    const connection=row({status:"revoked",revokedAt:new Date()});mocks.selections.push([connection]);
    const started=await connectStart(session);const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    const pending=mocks.insertValues.mock.calls[1][0];
    mocks.selections.push([connection],[{id:"cursor",cursor:pending.cursor}]);mocks.updates.push([{id:"cursor"}],[{id:"connection"}]);
    mocks.profile.mockResolvedValue({id:"different-object",displayName:"Other",userPrincipalName:"other@example.com",mail:null});
    await finishConnect(session,state,"code");
    expect(mocks.updateValues.mock.calls[2][0]).toMatchObject({cursor:null,lastErrorCode:"teams_account_changed"});
  });
  it("disconnect removes secrets while preserving account identity and meeting mappings",async()=>{
    mocks.selections.push([row()]);mocks.updates.push([{id:"connection"}]);
    await disconnect(session);
    const saved=JSON.parse(mocks.updateValues.mock.calls[0][0].encryptedCredentials);
    expect(saved).toMatchObject({account:{id:"object"},tenantId:tokens.tenantId});
    expect(saved.tokens).toBeUndefined();
    expect(mocks.updateWhere.mock.calls[1][0]).toContainEqual({like:"resourceType",pattern:"oauth:%"});
  });
});
describe("Teams revoked grant / app misconfiguration",()=>{
  const expired=()=>row({encryptedCredentials:JSON.stringify({...JSON.parse(row().encryptedCredentials),expiresAt:1})});
  it("invalid_grant on refresh persists reconnect_required, drops tokens and keeps identity",async()=>{
    const current=expired();mocks.selections.push([current]);mocks.updates.push([{id:"connection"}]);
    mocks.refreshed.mockRejectedValue(new TeamsProviderError("teams_reconnect_required",401));
    const caller=vi.fn();
    await expect(withTeamsToken(session,caller)).rejects.toMatchObject({code:"teams_reconnect_required",status:401});
    expect(caller).not.toHaveBeenCalled();
    expect(mocks.refreshed).toHaveBeenCalledWith(expect.anything(),"private-refresh",tokens.tenantId);
    const set=mocks.updateValues.mock.calls[0][0];
    expect(set.status).toBe("reconnect_required");
    const saved=JSON.parse(set.encryptedCredentials);
    expect(saved.tokens).toBeUndefined();expect(saved.expiresAt).toBeUndefined();
    expect(saved).toMatchObject({account:{id:"object"},tenantId:tokens.tenantId,binding,generation:"g"});
    // Compare-and-swap: only the still-connected row with the same ciphertext is flipped.
    expect(mocks.updateWhere.mock.calls[0][0]).toEqual(expect.arrayContaining([{a:"id",b:"connection"},{a:"status",b:"connected"},{null:"revokedAt"},{a:"credentials",b:current.encryptedCredentials}]));
  });
  it("status reports reconnectRequired with safe account metadata and no credentials",async()=>{
    const saved={...JSON.parse(row().encryptedCredentials)};delete saved.tokens;delete saved.expiresAt;
    mocks.selections.push([row({status:"reconnect_required",encryptedCredentials:JSON.stringify(saved)})]);
    const result=await status(session);
    expect(result).toEqual({configured:true,connected:false,reconnectRequired:true,errorCode:"teams_reconnect_required",account:{displayName:"V",username:"v@vndrly.ai"}});
    expect(JSON.stringify(result)).not.toContain("private-");
    // A connected row that the reconnect flips is not reported as connected by getTeamsConnection either.
    mocks.selections.push([row({status:"reconnect_required"})]);
    await expect(getTeamsConnection(session)).resolves.toBeNull();
  });
  it("teams_app_misconfigured on refresh is surfaced without marking the user's connection",async()=>{
    mocks.selections.push([expired()]);
    mocks.refreshed.mockRejectedValue(new TeamsProviderError("teams_app_misconfigured",503));
    await expect(withTeamsToken(session,vi.fn())).rejects.toMatchObject({code:"teams_app_misconfigured",status:503});
    expect(mocks.updateValues).not.toHaveBeenCalled();
  });
  it("Graph 401 forces one refresh; reads retry with the new token, mutations do not",async()=>{
    const rotated={...tokens,accessToken:"private-access-2"};mocks.refreshed.mockResolvedValue(rotated);
    const refreshedRow=row({encryptedCredentials:JSON.stringify({...JSON.parse(row().encryptedCredentials),tokens:rotated})});
    mocks.selections.push([row()],[refreshedRow]);mocks.updates.push([{id:"connection"}]);
    const read=vi.fn().mockRejectedValueOnce(new TeamsProviderError("provider_reauthentication_required",401)).mockResolvedValue("ok");
    await expect(withTeamsToken(session,read,{retryReadOnUnauthorized:true})).resolves.toBe("ok");
    expect(read.mock.calls.map(c=>c[0])).toEqual(["private-access","private-access-2"]);
    mocks.selections.push([row()],[refreshedRow]);mocks.updates.push([{id:"connection"}]);
    const write=vi.fn().mockRejectedValue(new TeamsProviderError("provider_reauthentication_required",401));
    await expect(withTeamsToken(session,write)).rejects.toMatchObject({code:"provider_reauthentication_required"});
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("Graph 401 followed by invalid_grant marks reconnect_required",async()=>{
    mocks.selections.push([row()]);mocks.updates.push([{id:"connection"}]);
    mocks.refreshed.mockRejectedValue(new TeamsProviderError("teams_reconnect_required",401));
    const read=vi.fn().mockRejectedValue(new TeamsProviderError("provider_reauthentication_required",401));
    await expect(withTeamsToken(session,read,{retryReadOnUnauthorized:true})).rejects.toMatchObject({code:"teams_reconnect_required"});
    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.updateValues.mock.calls[0][0].status).toBe("reconnect_required");
  });
  it("a rejected authorization code is a sign-in failure, and reconnect after revocation may switch account",async()=>{
    const connection=row({status:"reconnect_required"});mocks.selections.push([connection]);
    const started=await connectStart(session);const state=new URL(started.authorizationUrl).searchParams.get("state")!;
    const pending=mocks.insertValues.mock.calls[1][0];
    mocks.selections.push([connection],[{id:"cursor",cursor:pending.cursor}]);mocks.updates.push([{id:"cursor"}],[{id:"connection"}]);
    mocks.profile.mockResolvedValue({id:"different-object",displayName:"Other",userPrincipalName:"other@example.com",mail:null});
    await expect(finishConnect(session,state,"code")).resolves.toMatchObject({connected:true});
    expect(mocks.updateValues.mock.calls.at(-1)![0]).toMatchObject({cursor:null,lastErrorCode:"teams_account_changed"});
    mocks.selections.push([row()]);
    const again=await connectStart(session);const state2=new URL(again.authorizationUrl).searchParams.get("state")!;
    const pending2=mocks.insertValues.mock.calls.at(-1)![0];
    mocks.selections.push([row()],[{id:"cursor",cursor:pending2.cursor}]);mocks.updates.push([{id:"cursor"}]);
    mocks.exchanged.mockRejectedValue(new TeamsProviderError("teams_reconnect_required",401));
    await expect(finishConnect(session,state2,"code")).rejects.toMatchObject({code:"teams_invalid_oauth_state"});
  });
});
