import { afterEach, expect, it, vi } from "vitest";
import { encryptConnection, decryptConnection } from "./crypto";
afterEach(()=>vi.unstubAllEnvs());
it("keeps saved connections readable across different login-session signing keys",()=>{
 vi.stubEnv("COMMS_CREDS_KEY","ab".repeat(32));vi.stubEnv("SESSION_SECRET","local-session");
 const encrypted=encryptConnection("synthetic-connection");
 vi.stubEnv("SESSION_SECRET","production-session");
 expect(decryptConnection(encrypted)).toBe("synthetic-connection");
 vi.stubEnv("COMMS_CREDS_KEY","cd".repeat(32));
 expect(()=>decryptConnection(encrypted)).toThrow();
});
