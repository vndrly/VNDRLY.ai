import { describe, expect, it } from "vitest";

import {
  EMPLOYEE_ACCOUNT_ACTIONS_CLASS_NAME,
  ONBOARDING_INVITE_LABEL,
  shouldShowOnboardingInvite,
} from "./employee-portal-login-fields";

describe("EmployeePortalLoginFields account actions", () => {
  it("keeps the onboarding invite available after a login exists", () => {
    expect(shouldShowOnboardingInvite(true, true, true)).toBe(true);
    expect(shouldShowOnboardingInvite(true, true, false)).toBe(true);
    expect(shouldShowOnboardingInvite(true, false, true)).toBe(false);
  });

  it("uses the compact one-row account action treatment", () => {
    expect(ONBOARDING_INVITE_LABEL).toBe("Send Invite");
    expect(EMPLOYEE_ACCOUNT_ACTIONS_CLASS_NAME).toContain("grid-cols-5");
    expect(EMPLOYEE_ACCOUNT_ACTIONS_CLASS_NAME).not.toContain("grid-cols-2");
  });
});
