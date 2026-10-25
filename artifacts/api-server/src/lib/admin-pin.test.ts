import { expect, it, vi } from "vitest";
import { adminPinAction, needsAdminPin, hashAdminPin, verifyAdminPin } from "./admin-pin";
const store = () => ({ attempts: vi.fn(async () => 1), create: vi.fn(async (_hash: string) => true) });
it("requires setup for office/admin roles, not field gatekeepers", () => {
  for (const ctx of [{role:"admin"}, {role:"vendor",membershipRole:"admin"}, {role:"field_employee",vendorRole:"office"}, {role:"partner",membershipRole:"admin"}]) expect(needsAdminPin(ctx)).toBe(true);
  expect(needsAdminPin({role:"field_employee",vendorRole:"field",membershipRole:"field_employee"})).toBe(false);
});
it("status exposes only configuration flags and does not write", async () => {
  const s=store();
  expect(await adminPinAction({method:"GET",eligible:true,hash:null},s)).toEqual({status:200,body:{required:true,configured:false}});
  expect(await adminPinAction({method:"GET",eligible:true,hash:"secret-hash"},s)).toEqual({status:200,body:{required:false,configured:true}});
  expect(s.create).not.toHaveBeenCalled(); expect(s.attempts).not.toHaveBeenCalled();
});
it("rejects field account writes", async () => {
  const s=store(); expect((await adminPinAction({method:"POST",eligible:false,hash:null,body:{action:"create",pin:"7531",confirmPin:"7531"}},s)).status).toBe(403); expect(s.create).not.toHaveBeenCalled();
});
it("rejects malformed or mismatched PINs", async () => {
  const s=store();
  for(const pin of [1234,"123","12345","abcd"]) expect((await adminPinAction({method:"POST",eligible:true,hash:null,body:{action:"create",pin,confirmPin:pin}},s)).status).toBe(400);
  expect((await adminPinAction({method:"POST",eligible:true,hash:null,body:{action:"create",pin:"7531",confirmPin:"1357"}},s)).status).toBe(400);
  expect(s.create).not.toHaveBeenCalled();
});
it("stores a salted hash, verifies it, and rejects a different PIN", async () => {
  const s=store(); expect((await adminPinAction({method:"POST",eligible:true,hash:null,body:{action:"create",pin:"7531",confirmPin:"7531"}},s)).status).toBe(200);
  const hash=s.create.mock.calls[0][0]; expect(hash).not.toBe("7531");
  expect(await verifyAdminPin("7531",hash)).toBe(true); expect(await verifyAdminPin("1357",hash)).toBe(false);
  expect((await adminPinAction({method:"POST",eligible:true,hash,body:{action:"verify",pin:"7531"}},s)).status).toBe(200);
  expect((await adminPinAction({method:"POST",eligible:true,hash,body:{action:"verify",pin:"1357"}},s)).status).toBe(403);
});
it("never overwrites existing PINs, including racing setup requests", async () => {
  const s=store(); expect((await adminPinAction({method:"POST",eligible:true,hash:"existing",body:{action:"create",pin:"7531",confirmPin:"7531"}},s)).status).toBe(409); expect(s.create).not.toHaveBeenCalled();
  s.create.mockResolvedValue(false); expect((await adminPinAction({method:"POST",eligible:true,hash:null,body:{action:"create",pin:"7531",confirmPin:"7531"}},s)).status).toBe(409);
});
it("limits repeated attempts before hashing or writing", async () => {
  const s=store(); s.attempts.mockResolvedValue(6);
  expect((await adminPinAction({method:"POST",eligible:true,hash:null,body:{action:"create",pin:"7531",confirmPin:"7531"}},s)).status).toBe(429); expect(s.create).not.toHaveBeenCalled();
});
it("rejects invalid values before hashing", async () => { await expect(hashAdminPin("bad")).rejects.toThrow(); });
