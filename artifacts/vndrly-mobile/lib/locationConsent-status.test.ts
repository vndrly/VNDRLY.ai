import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({api:vi.fn()}));
vi.mock("./api",()=>({apiFetch:m.api}));
vi.mock("./deviceId",()=>({getDeviceId:async()=>"phone"}));
vi.mock("expo-secure-store",()=>({getItemAsync:vi.fn(),setItemAsync:vi.fn(),deleteItemAsync:vi.fn()}));
import {getDeviceConsentStatus,hasActiveConsentForThisDevice} from "./locationConsent";
beforeEach(()=>vi.clearAllMocks());
it("inherits the already accepted consent for this exact phone",async()=>{
 m.api.mockResolvedValue({consents:[{deviceId:"phone",revokedAt:null}]});expect(await getDeviceConsentStatus()).toBe("accepted");expect(await hasActiveConsentForThisDevice()).toBe(true);
});
it("distinguishes unavailable network from consent that was never accepted",async()=>{
 m.api.mockRejectedValue(new Error("offline"));expect(await getDeviceConsentStatus()).toBe("unavailable");expect(await hasActiveConsentForThisDevice()).toBe(false);
});
it("does not inherit a different phone's consent or revoked consent",async()=>{
 m.api.mockResolvedValue({consents:[{deviceId:"other",revokedAt:null},{deviceId:"phone",revokedAt:"2026-10-19T00:00:00Z"}]});expect(await getDeviceConsentStatus()).toBe("not_accepted");
});
