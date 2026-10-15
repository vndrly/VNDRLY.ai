import { vi, expect, it } from "vitest";
vi.mock("@workspace/db",()=>({db:{}}));
import { liveMeetingVersion, requireMeetingVersion } from "./live-meetings";
it("uses a separate admission version and refuses stale decisions",()=>{
 expect(liveMeetingVersion({})).toBe(0);
 expect(liveMeetingVersion({admissionVersion:3})).toBe(3);
 expect(()=>requireMeetingVersion({admissionVersion:3},2)).toThrow("changed");
 expect(()=>requireMeetingVersion({admissionVersion:3},3)).not.toThrow();
});
