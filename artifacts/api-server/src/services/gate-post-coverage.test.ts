import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), active: vi.fn(), notify: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect:m.connect } }));
vi.mock("./gate-change-over", () => ({ ChangeOverError: class extends Error { constructor(public status:number,public code:string,message:string) { super(message); } }, requireChangeOverAccess: async () => ({ supervisor:true }), listChangeOverSites: vi.fn() }));
vi.mock("./native-operations", () => ({ getNativeCompanyPolicy: async () => ({ enabled:true }), nativeWorkDutyActive:m.active }));
vi.mock("../routes/notifications", () => ({ notifyUsers:m.notify }));
import { ownCoverageStatus, recordWorkCoverageLocation, recordGateSharingChange, resolvePostIncident } from "./gate-post-coverage";
const session:any={userId:1,vendorId:54,activeMembershipId:7,sv:2};
const client={query:m.query,release:m.release} as any;
beforeEach(() => { vi.clearAllMocks(); m.connect.mockResolvedValue(client); m.active.mockResolvedValue(true); m.query.mockImplementation(async (sql:string) => ({ rowCount:1, rows:sql.includes("SELECT native_operations")?[{native_operations:{consent:{locationSharing:true},designatedDeviceId:"device"}}]:sql.includes("SELECT d.id")?[]:[] })); });
it("revalidates native duty and retains a borrowed transaction client", async () => {
  expect((await ownCoverageStatus(session,"device",client)).canReport).toBe(true);
  expect(m.active).toHaveBeenCalledWith(client,session); expect(m.release).not.toHaveBeenCalled();
});
it("refuses stale GPS before opening any database connection", async () => {
  await expect(recordWorkCoverageLocation(session,"device",{latitude:35,longitude:-97,accuracy:5,capturedAt:new Date(Date.now()-180000).toISOString()})).rejects.toMatchObject({status:400});
  expect(m.connect).not.toHaveBeenCalled();
});
it("rechecks consent inside the same native authority lock before recording GPS", async () => {
  m.query.mockImplementation(async (sql:string) => ({ rowCount:1,rows:sql.includes("SELECT native_operations")?[{native_operations:{consent:{locationSharing:false},designatedDeviceId:"device"}}]:[] }));
  await expect(recordWorkCoverageLocation(session,"device",{latitude:35,longitude:-97,accuracy:5,capturedAt:new Date().toISOString()})).rejects.toMatchObject({status:403});
  expect(m.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock(hashtextextended"),["native:54:1"]);
  expect(m.query.mock.calls.some(c=>c[0].includes("INSERT INTO assistant_action_audit"))).toBe(false);
  expect(m.release).toHaveBeenCalledTimes(1);
});
it("logs sharing off and on while retaining an unresolved inquiry for supervisor action", async () => {
  const duty:any={id:"duty",site_id:10,station_id:"station",display_name:"Synthetic worker",post_coverage:{}};
  m.query.mockImplementation(async (sql:string,args:any[]) => {
    if(sql.includes("SELECT d.*"))return {rows:[duty]};
    if(sql.includes("SELECT DISTINCT m.user_id"))return {rows:[{user_id:2}]};
    if(sql.startsWith("UPDATE gate_duty_sessions"))duty.post_coverage=JSON.parse(args[1]);
    return {rows:[],rowCount:1};
  });
  await recordGateSharingChange(client,session,false); const incident=duty.post_coverage.sharingIncident;
  expect(incident.departedAt).toBeTruthy();
  await recordGateSharingChange(client,session,true); expect(duty.post_coverage.sharingIncident).toMatchObject({id:incident.id,restoredAt:expect.any(String)});
  expect(duty.post_coverage.sharingIncident.resolvedAt).toBeUndefined();
  const audit=m.query.mock.calls.filter(c=>c[0].includes("INSERT INTO assistant_action_audit"));
  expect(audit.map(c=>JSON.parse(c[1][4]).enabled)).toEqual([false,true]);
});
it("binds supervisor departure actions to the incident company", async () => {
  await expect(resolvePostIncident(session,"duty","resolve","Contacted worker")).rejects.toMatchObject({status:404});
  expect(m.query).toHaveBeenCalledWith(expect.stringContaining("(d.post_coverage->>'vendorId')::int=$2"),["duty",54]);
});
