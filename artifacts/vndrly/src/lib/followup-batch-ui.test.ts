import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(resolve(__dirname, relative), "utf8");

describe("follow-up batch UI contracts", () => {
  it("temporarily removes compliance and rates from vendor onboarding and setup reminders", () => {
    const onboarding = source("../pages/onboarding-vendor.tsx");
    const widget = source("../components/finish-setup-widget.tsx");

    expect(onboarding).not.toContain("Rates & 1099");
    expect(onboarding).not.toContain("1099 delivery");
    expect(widget).not.toContain("Rates & 1099");
    expect(widget).not.toContain("1099 delivery");
    expect(onboarding).not.toContain('{ key: "compliance", label: "Compliance" }');
    expect(onboarding).not.toContain('{ key: "rates", label: "Rates" }');
    expect(widget).not.toContain('rates: { label: "Set your rates"');
    expect(widget).not.toContain('compliance: { label: "Upload your insurance certificate"');
    expect(onboarding).toContain("onStepClick");
  });

  it("routes logout to sign in and uses a two-thirds modal fade", () => {
    const auth = source("../hooks/use-auth.tsx");
    const modalTokens = source("../components/app-modal-tokens.ts");

    expect(auth).toContain('window.location.replace(`${BASE}/login${qs}`)');
    expect(modalTokens).toContain("black 66%, transparent 100%");
    expect(modalTokens).toContain('backgroundSize: "auto 100%"');
  });

  it("does not overlay an organization logo inside the employee form scroller", () => {
    const employees = source("../pages/field-employees.tsx");
    expect(employees).not.toContain("img-edit-office-vendor-logo");
  });

  it("keeps Ask V persistent and leaves the page interactive", () => {
    const assistant = source("../components/assistant-panel.tsx");
    expect(assistant).toContain('modal={false}');
    expect(assistant).toContain("hideOverlay");
    expect(assistant).toContain("setOpen((value) => !value)");
    expect(assistant).toContain('sessionStorage.getItem("vndrly.askv.panelOpen")');
    expect(assistant).toContain("onPointerDownOutside");
  });

  it("shows insurance as optional and keeps employee account actions aligned", () => {
    const onboarding = source("../pages/onboarding-vendor.tsx");
    const loginActions = source("../components/employee-portal-login-fields.tsx");
    const accountActions = source("../components/account-actions.tsx");

    expect(onboarding).toContain("Optional for now");
    expect(onboarding).not.toContain("Carrier and policy number are required.");
    expect(loginActions).toContain('className="grid grid-cols-2 gap-2 sm:flex"');
    expect(accountActions).toContain('className="grid grid-cols-2 gap-2 sm:flex"');
  });
});
