import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: null }),
  useGetVendor: () => ({ data: null }),
  getGetPartnerQueryKey: () => [],
  getGetVendorQueryKey: () => [],
}));

describe("inline dialog frame", () => {
  it("renders in document flow without trapping keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <Dialog open>
        <button>Before assistant</button>
        <div data-testid="page-card">
          <DialogContent inline hideOverlay data-testid="inline-assistant">
            <DialogTitle>Embedded assistant</DialogTitle>
            <DialogDescription>Full conversation</DialogDescription>
            <button>Inside assistant</button>
          </DialogContent>
        </div>
        <button>After assistant</button>
      </Dialog>,
    );
    const frame = screen.getByTestId("inline-assistant");
    expect(frame.className).toContain("relative");
    expect(frame.className).not.toContain("fixed left-[50%]");
    expect(screen.getByTestId("page-card").contains(frame)).toBe(true);
    screen.getByRole("button", { name: "Before assistant" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inside assistant" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After assistant" }));
  });
});
