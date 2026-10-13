import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ records: new Map<string,string>(), api: vi.fn(), start: vi.fn(), stop: vi.fn(), running: false, allowed: true, consent: true, permission: true, epoch: 0, companyId: 54, task: null as any }));
vi.mock("expo-secure-store", () => ({ AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "device", getItemAsync: async (k:string) => m.records.get(k) ?? null, setItemAsync: async (k:string,v:string) => { m.records.set(k,v); }, deleteItemAsync: async (k:string) => { m.records.delete(k); } }));
vi.mock("expo-location", () => ({ Accuracy: { Balanced: 1 }, ActivityType: { Other: 1 }, getForegroundPermissionsAsync: async () => ({ status: m.permission ? "granted" : "denied" }), getBackgroundPermissionsAsync: async () => ({ status: m.permission ? "granted" : "denied" }), hasStartedLocationUpdatesAsync: async () => m.running, startLocationUpdatesAsync: async (...args:any[]) => { m.running=true; m.start(...args); }, stopLocationUpdatesAsync: async () => { m.running=false; m.stop(); } }));
vi.mock("expo-task-manager", () => ({ isTaskDefined: () => false, defineTask: (name:string,callback:any) => { m.task={name,callback}; } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("./api", () => ({ apiFetch: m.api }));
vi.mock("./deviceId", () => ({ getDeviceId: async () => "device" }));
vi.mock("./native-operations", () => ({ nativeLocationLocallyAllowed: async () => m.allowed }));
vi.mock("./locationConsent", () => ({ hasActiveConsentForThisDevice: async () => m.consent }));
vi.mock("./runtime", () => ({ isExpoGo: false }));
vi.mock("./auth", () => ({ getUser: async () => ({ id: 1, vendorId: m.companyId, activeMembershipId: 7 }), captureAuthScope: () => ({ generation: m.epoch }), isAuthScopeCurrent: (s:any) => s.generation===m.epoch, subscribeUser: () => {}, subscribeToken: () => {} }));
import { DUTY_LOCATION_TASK, synchronizeDutyBackgroundLocation, reportDutyBackgroundSample, stopDutyBackgroundLocation } from "./duty-background-location";
const sample = () => ({ timestamp: Date.now(), coords: { latitude:35,longitude:-97,accuracy:5 } } as any);
beforeEach(async () => { await stopDutyBackgroundLocation(); m.records.clear(); m.start.mockClear(); m.stop.mockClear(); m.allowed=true; m.consent=true; m.permission=true; m.companyId=54; m.api.mockReset().mockImplementation(async (_path:string,options?:any) => options?.method ? { accepted:true } : { canReport:true,active:true,userId:1,companyId:m.companyId,membershipId:7 }); });
it("starts Gate/general duty OS sharing and publishes actual capture times without a ticket", async () => {
  await synchronizeDutyBackgroundLocation(); expect(m.task.name).toBe(DUTY_LOCATION_TASK);
  expect(m.start).toHaveBeenCalledWith(DUTY_LOCATION_TASK,expect.objectContaining({ showsBackgroundLocationIndicator:true }));
  const fix=sample(); await reportDutyBackgroundSample(fix);
  expect(m.api).toHaveBeenCalledWith("/api/gate-change-over/work-location",expect.objectContaining({ body:JSON.stringify({ deviceId:"device",location:{latitude:35,longitude:-97,accuracy:5,capturedAt:new Date(fix.timestamp).toISOString()} }) }),expect.anything());
});
it("refuses old/inaccurate callbacks and stops when consent is withdrawn", async () => {
  await synchronizeDutyBackgroundLocation(); m.api.mockClear();
  await reportDutyBackgroundSample({ ...sample(),timestamp:Date.now()-180000 });
  await reportDutyBackgroundSample({ ...sample(),coords:{latitude:35,longitude:-97,accuracy:101} });
  expect(m.api).not.toHaveBeenCalled();
  m.consent=false; await reportDutyBackgroundSample(sample()); expect(m.running).toBe(false); expect(m.records.size).toBe(0);
});
it("cannot publish a cold callback against a different company", async () => {
  await synchronizeDutyBackgroundLocation(); m.companyId=55; m.api.mockClear(); await reportDutyBackgroundSample(sample());
  expect(m.api.mock.calls.some(c=>c[1]?.method==="POST")).toBe(false); expect(m.running).toBe(false);
});
it("does not restart OS sharing after a local end duty or denied permission", async () => {
  m.allowed=false; await synchronizeDutyBackgroundLocation(); expect(m.start).not.toHaveBeenCalled();
  m.allowed=true; m.permission=false; await synchronizeDutyBackgroundLocation(); expect(m.start).not.toHaveBeenCalled();
});
