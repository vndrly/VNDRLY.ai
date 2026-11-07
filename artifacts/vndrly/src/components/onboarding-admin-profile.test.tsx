import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadAdminInvite } from "./onboarding-admin-profile";

const { ownership, inviteLeadAdmin } = vi.hoisted(() => ({
  ownership: vi.fn(),
  inviteLeadAdmin: vi.fn(),
}));
vi.mock("@/lib/onboarding-api", () => ({ onboardingApi: { ownership, inviteLeadAdmin } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function openInvite() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LeadAdminInvite orgType="vendor" orgId={1} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add New Admin" }));
}

describe("Lead Admin ownership invitations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inviteLeadAdmin.mockResolvedValue({ sent: true });
  });

  it("requires a second action before sending an ownership invitation", async () => {
    ownership.mockResolvedValue({ canTransfer: true });
    openInvite();
    const checkbox = await screen.findByRole("checkbox", { name: "Make Owner" });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Doe" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.test" } });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));
    expect(screen.getByText(/transfer ownership to Jane Doe/i)).toBeTruthy();
    expect(inviteLeadAdmin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Send Invitation" }));
    await waitFor(() => expect(inviteLeadAdmin).toHaveBeenCalledWith("vendor", expect.objectContaining({
      email: "jane@example.test", makeOwner: true, confirmOwnership: true,
    })));
  });

  it("hides Make Owner from an administrator who does not own the organization", async () => {
    ownership.mockResolvedValue({ canTransfer: false });
    openInvite();
    await waitFor(() => expect(ownership).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: "Make Owner" })).toBeNull();
  });
});
