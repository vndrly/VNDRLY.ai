import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OnboardingLegalConsentStep } from "./onboarding-legal-consent-step";
import { LEGAL_POLICY_VERSION, SMS_ENROLLMENT_POLICY_PATH } from "@/lib/legal-docs";

afterEach(cleanup);

it("offers three legal documents with one explicit organization acceptance", () => {
  const onChange = vi.fn();
  render(<OnboardingLegalConsentStep value={{ accepted: true, version: "2026-08-20" }} onChange={onChange} />);

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "SMS Enrollment Policy" }).getAttribute("href")).toBe(SMS_ENROLLMENT_POLICY_PATH);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(checkbox);
  expect(onChange).toHaveBeenCalledWith({ accepted: true, version: LEGAL_POLICY_VERSION });
});
