import {expect,it,vi,beforeEach} from "vitest";
const m=vi.hoisted(()=>({accept:vi.fn(),read:vi.fn(),consent:vi.fn(),designate:vi.fn(),saved:vi.fn(),current:true}));
vi.mock("./auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>m.current}));
vi.mock("./locationConsent",()=>({acceptConsent:m.accept,hasActiveConsentForThisDevice:m.saved}));
vi.mock("./native-operations",()=>({readNativeOperations:m.read,updateNativeConsent:m.consent,designateNativeWorkPhone:m.designate}));
vi.mock("./deviceId",()=>({getDeviceId:async()=>"phone"}));
import {enableFleetRunLocation} from "./fleet-location-setup";
beforeEach(()=>{vi.clearAllMocks();m.current=true;m.saved.mockResolvedValue(false);m.read.mockResolvedValue({designatedDeviceId:null});});
it("an explicit enable action saves both consents and enrolls the phone when none is designated",async()=>{
 await enableFleetRunLocation();expect(m.accept).toHaveBeenCalledOnce();expect(m.consent).toHaveBeenCalledWith(true);expect(m.designate).toHaveBeenCalledOnce();
});
it("preserves an existing different designated work phone",async()=>{
 m.read.mockResolvedValue({designatedDeviceId:"other"});await expect(enableFleetRunLocation()).rejects.toThrow();expect(m.designate).not.toHaveBeenCalled();expect(m.accept).not.toHaveBeenCalled();
});
it("does not carry an old consent action into another account",async()=>{
 m.read.mockImplementation(async()=>{m.current=false;return{designatedDeviceId:null};});await expect(enableFleetRunLocation()).rejects.toThrow();expect(m.accept).not.toHaveBeenCalled();
});

it("inherits saved device consent without rewriting the original acceptance",async()=>{
 m.saved.mockResolvedValue(true);m.read.mockResolvedValue({designatedDeviceId:"phone"});await enableFleetRunLocation();expect(m.accept).not.toHaveBeenCalled();expect(m.designate).not.toHaveBeenCalled();
});
