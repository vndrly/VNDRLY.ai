import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import EmployeeDialogContent from "./employee-dialog-content";
import { BrandedCheckbox } from "./branded-checkbox";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "MidCon Solutions",
    logoUrl: "/midcon-wide.png",
    logoSquareUrl: "/midcon-square.png",
  }),
}));

describe("EmployeeDialogContent", () => {
  it("renders checked controls with the organization brand treatment", () => {
    render(<BrandedCheckbox checked aria-label="Branded setting" />);

    const checkbox = screen.getByRole("checkbox", { name: "Branded setting" });
    expect(checkbox.className).toContain("border-[color:var(--brand-primary)]");
    expect(checkbox.className).toContain("data-[state=checked]:bg-[color:var(--brand-primary)]");
  });

  it("uses the approved Ask V header geometry, square company logo, and inset close control", () => {
    render(
      <Dialog open>
        <EmployeeDialogContent title="Edit Employee" description="Manage employee details">
          <div>Employee form</div>
        </EmployeeDialogContent>
      </Dialog>,
    );

    expect(screen.getByTestId("modal-accent-header").style.height).toBe("118px");
    expect(screen.getByTestId("employee-dialog-logo").querySelector("img")?.getAttribute("src")).toBe(
      "/midcon-square.png",
    );
    expect(screen.getByTestId("employee-dialog-header").className).toContain("pt-[70px]");
    expect(screen.getByTestId("employee-dialog-close")).not.toBeNull();
    expect(screen.getByText("Employee form")).not.toBeNull();
  });
});