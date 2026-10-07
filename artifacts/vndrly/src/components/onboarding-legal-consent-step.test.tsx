import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OnboardingLegalConsentStep } from "./onboarding-legal-consent-step";
import { LEGAL_POLICY_VERSION } from "@/lib/legal-docs";
afterEach(cleanup);
it("renders stale acceptance unchecked and does not renew it by toggling optional SMS", () => {
  const onChange = vi.fn();
  render(
    <OnboardingLegalConsentStep
      value={{ accepted: true, version: "2026-08-20", smsOptIn: false }}
      onChange={onChange}
    />,
  );
  expect(
    screen.getByTestId("checkbox-legal-accept").getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(screen.getByTestId("checkbox-sms-opt-in"));
  expect(onChange).toHaveBeenCalledWith({
    accepted: false,
    version: LEGAL_POLICY_VERSION,
    smsOptIn: true,
  });
});
it("preserves current explicit acceptance on SMS changes and permits a human agreement click", () => {
  const onChange = vi.fn();
  const view = render(
    <OnboardingLegalConsentStep
      value={{ accepted: true, version: LEGAL_POLICY_VERSION, smsOptIn: false }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByTestId("checkbox-sms-opt-in"));
  expect(onChange).toHaveBeenLastCalledWith({
    accepted: true,
    version: LEGAL_POLICY_VERSION,
    smsOptIn: true,
  });
  view.rerender(
    <OnboardingLegalConsentStep
      value={{ accepted: true, version: "2026-08-20", smsOptIn: false }}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByTestId("checkbox-legal-accept"));
  expect(onChange).toHaveBeenLastCalledWith({
    accepted: true,
    version: LEGAL_POLICY_VERSION,
    smsOptIn: false,
  });
});
