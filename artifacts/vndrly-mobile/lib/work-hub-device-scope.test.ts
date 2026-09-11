import { describe, expect, it } from "vitest";
import { mobileWorkHubModules } from "./work-hub-mobile";
describe("mobile Work Hub suite boundaries", () => {
  it("exposes daily collaboration without financial execution or bulk import", () => {
    const phone = mobileWorkHubModules(false, false).map((x) => x.key);
    const tablet = mobileWorkHubModules(true, true).map((x) => x.key);
    expect(phone).toContain("chat");
    expect(phone).toContain("calls");
    expect(phone).toContain("activity");
    expect(tablet).toContain("crews");
    expect(tablet).not.toContain("payroll");
    expect(tablet).not.toContain("imports");
  });
});
