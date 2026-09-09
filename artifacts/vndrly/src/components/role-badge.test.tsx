import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ primary: "#4A8FAF", name: "MidCon Solutions" }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => brand }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}));

import RoleBadge from "./role-badge";
import EmployeeRolePill from "./employee-role-pill";
import { PILL_BRAND, PILL_IDLE, pillAmber, pillGreen, pillPurple } from "@/lib/pill-palette-assets";

const artwork = (element: HTMLElement) => element.querySelector("img")?.getAttribute("src");

describe("branded employee and team role pills", () => {
  beforeEach(() => { brand.primary = "#4A8FAF"; brand.name = "MidCon Solutions"; });

  it.each(["office", "field", "both", "foreman", "gatekeeper", "member", "ap", "field_employee"])(
    "uses the company pill for non-admin role %s",
    (role) => {
      render(<RoleBadge role={role} data-testid="role" />);
      const badge = screen.getByTestId("role");
      expect(artwork(badge)).toBe(PILL_BRAND.midcon);
      expect(badge.style.height).toBe("23px");
      expect(badge.className).toContain("pointer-events-none");
    },
  );

  it("keeps Admin amber when the company brand changes", () => {
    const { rerender } = render(<RoleBadge role="admin" />);
    expect(artwork(screen.getByTestId("employee-role-pill-admin"))).toBe(pillAmber);
    brand.primary = "#7C3AED"; brand.name = "Example Company";
    rerender(<RoleBadge role="admin" />);
    expect(artwork(screen.getByTestId("employee-role-pill-admin"))).toBe(pillAmber);
  });

  it("updates non-admin pills as the primary color changes", () => {
    brand.name = "Example Company"; brand.primary = "#7C3AED";
    const { rerender } = render(<RoleBadge role="member" />);
    expect(artwork(screen.getByTestId("employee-role-pill-member"))).toBe(pillPurple);
    brand.primary = "#149F3D";
    rerender(<RoleBadge role="member" />);
    expect(artwork(screen.getByTestId("employee-role-pill-member"))).toBe(pillGreen);
  });

  it("uses readable dark labels on neutral brand artwork", () => {
    brand.name = "Example Company"; brand.primary = "#777777";
    render(<RoleBadge role="office" />);
    expect(artwork(screen.getByTestId("employee-role-pill-office"))).toBe(PILL_IDLE);
    expect(screen.getByText("Office").className).toContain("text-gray-700");
  });

  it("shares branding with the field employee wrapper and retains its custom height", () => {
    render(<EmployeeRolePill role="field" height={28} />);
    const badge = screen.getByTestId("employee-role-pill-field");
    expect(artwork(badge)).toBe(PILL_BRAND.midcon);
    expect(badge.style.height).toBe("28px");
    expect(screen.getByText("Field")).toBeTruthy();
  });
});
