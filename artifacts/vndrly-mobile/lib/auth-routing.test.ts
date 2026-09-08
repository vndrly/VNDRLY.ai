import { describe, expect, it } from "vitest";
import { resolveMobileLaunchRoute } from "./auth-routing";
describe("native launch routing", () => {
  it("sends cold, signed-out, and expired sessions to sign in", () => { expect(resolveMobileLaunchRoute({ authenticated: false, tokenExpired: false, requestedPath: null })).toBe("/login"); expect(resolveMobileLaunchRoute({ authenticated: false, tokenExpired: true, requestedPath: "/work-hub/tasks" })).toBe("/login"); });
  it("restores authenticated role home without a deep link", () => { expect(resolveMobileLaunchRoute({ authenticated: true, tokenExpired: false, requestedPath: null })).toBe("/(tabs)"); });
  it("preserves authenticated Work Hub deep links only", () => { expect(resolveMobileLaunchRoute({ authenticated: true, tokenExpired: false, requestedPath: "/work-hub/tasks" })).toBe("/work-hub/tasks"); expect(resolveMobileLaunchRoute({ authenticated: true, tokenExpired: false, requestedPath: "https://evil.example" })).toBe("/(tabs)"); });
});
