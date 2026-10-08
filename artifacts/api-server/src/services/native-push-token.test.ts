import {afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{connect:async()=>mocks}}));
import {bindNativePushToken} from "./native-push-token";
const actor={userId:7,vendorId:10,sv:2},input={token:"ExpoPushToken[synthetic]",platform:"ios",deviceId:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12"};
afterEach(()=>vi.resetAllMocks());
it("binds only an owned current registered phone under live account locks",async()=>{
 mocks.query.mockResolvedValue({rows:[{id:7}]});await bindNativePushToken(actor,input);
 expect(mocks.query.mock.calls.some(([sql])=>String(sql).includes("session_version=$2 AND suspended_at IS NULL"))).toBe(true);
 const device=mocks.query.mock.calls.find(([sql])=>String(sql).includes("FROM work_hub_devices"));expect(device?.[1]).toEqual([input.deviceId,7,"vendor",10]);expect(device?.[0]).toContain("revoked_at IS NULL");
 const save=mocks.query.mock.calls.find(([sql])=>String(sql).startsWith("INSERT INTO field_push_tokens"));expect(save?.[1]).toEqual([7,input.token,"ios",input.deviceId]);
});
it("rejects foreign or revoked phone without altering token ownership",async()=>{
 mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM work_hub_devices")?[]:[{id:7}]}));
 await expect(bindNativePushToken(actor,input)).rejects.toThrow("native.work_phone_required");
 expect(mocks.query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT"))).toBe(false);
 expect(mocks.query.mock.calls.some(([sql])=>sql==="ROLLBACK")).toBe(true);
});
