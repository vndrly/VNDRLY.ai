import { describe, it, expect } from "vitest";
import {
  PUBLIC_UNAUTHENTICATED_ALLOWLIST,
  GUEST_ALLOWLIST,
} from "./publicApiAllowlist";
describe("public invitation activation boundary", () => {
  it("allows only GET and POST token activation for anonymous and guest callers", () => {
    const path =
      "/api/implementation-a/account-invitations/activate/" + "a".repeat(64);
    for (const rules of [PUBLIC_UNAUTHENTICATED_ALLOWLIST, GUEST_ALLOWLIST]) {
      for (const method of ["GET", "POST"])
        expect(
          rules.some(
            (rule) => rule.method === method && rule.pattern.test(path),
          ),
        ).toBe(true);
      for (const method of ["DELETE", "PATCH"])
        expect(
          rules.some(
            (rule) => rule.method === method && rule.pattern.test(path),
          ),
        ).toBe(false);
      expect(rules.some((rule) => rule.pattern.test(path + "/resend"))).toBe(
        false,
      );
      expect(
        rules.some((rule) =>
          rule.pattern.test("/api/implementation-a/account-invitations"),
        ),
      ).toBe(false);
    }
  });
});
