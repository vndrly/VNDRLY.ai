import { expect, it, vi } from "vitest";
vi.mock("./sendgrid", () => ({ sendFieldEmployeeOnboardingInviteEmail: vi.fn() }));
import { renderStaffEnrollmentEmail } from "./staff-enrollment-email";
it("renders vendor and platform branding, the new-login password and enrollment link", () => {
  const message = renderStaffEnrollmentEmail({ vendorName: "GateGo", displayName: "A <B>", to: "worker@example.com", inviteUrl: "https://vndrly.ai/login", temporaryPassword: "Abcd2!xY", vendorLogoUrl: "https://vndrly.ai/gatego.png", platformLogoUrl: "https://vndrly.ai/logo.png", brandColor: "#f0b827" });
  expect(message.html).toContain("gatego.png"); expect(message.html).toContain("logo.png"); expect(message.html).toContain("Complete Enrollment"); expect(message.html).toContain("Abcd2!xY"); expect(message.html).toContain("A &lt;B&gt;"); expect(message.html).not.toContain("A <B>");
  expect(message.text).toContain("choose a new password");
});
it("does not invent a temporary password for existing accounts", () => {
  const message = renderStaffEnrollmentEmail({ vendorName: "GateGo", displayName: "Existing", to: "worker@example.com", inviteUrl: "https://vndrly.ai/login" });
  expect(message.text).toContain("existing VNDRLY password"); expect(message.text).not.toContain("Temporary password:");
});
