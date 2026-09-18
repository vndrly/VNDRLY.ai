import { render, screen } from "@testing-library/react";
import { Building2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { AppModalHeader } from "./app-modal-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "MidCon Solutions",
    logoUrl: "/midcon-wide.png",
    logoSquareUrl: "/midcon-square.png",
    primary: "#13b7c7",
  }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: null }),
  useGetVendor: () => ({ data: null }),
  getGetPartnerQueryKey: () => [],
  getGetVendorQueryKey: () => [],
}));

describe("AppModalHeader", () => {
  it("uses the approved Ask V geometry and control order", () => {
    render(
      <AppModalHeader
        closeControl={<button type="button">Close</button>}
        description="Live operational details"
        icon={Building2}
        settings={<button type="button">Settings</button>}
        title="Example modal"
      />,
    );

    expect(screen.getByTestId("app-modal-header-logo").querySelector("img")?.getAttribute("src")).toBe(
      "/midcon-square.png",
    );
    expect(screen.getByTestId("app-modal-header-controls").className).toContain("right-4");
    const controls = screen.getByTestId("app-modal-header-controls");
    expect(controls.textContent).toBe("SettingsClose");
  });

  it("hosts standard dialog titles and descriptions inside the shared header", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Example modal</DialogTitle>
            <DialogDescription>Example definition</DialogDescription>
          </DialogHeader>
          <div>Body content</div>
        </DialogContent>
      </Dialog>,
    );

    const header = screen.getByTestId("app-modal-header");
    expect(header.contains(screen.getByText("Example modal"))).toBe(true);
    expect(header.contains(screen.getByText("Example definition"))).toBe(true);
    expect(screen.getByTestId("app-modal-header-logo").querySelector("img")?.getAttribute("src")).toBe(
      "/midcon-square.png",
    );
    expect(screen.getByTestId("app-modal-header-controls").className).toContain("right-4");
  });
});
