import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { brandImagePillSrc } from "@/components/png-pill-rollover";
import ChangePasswordModal from "./change-password-modal";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { role: "vendor", mustChangePassword: true },
    clearMustChangePassword: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    primary: "#3260cd",
    name: "MidCon Solutions",
    logoUrl: "/midcon-wide.png",
    logoSquareUrl: "/midcon-square.png",
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("ChangePasswordModal", () => {
  it("uses the approved branded header, rounded fields, and brand action pill", () => {
    render(<ChangePasswordModal />);

    expect(screen.getByTestId("change-password-header").className).toContain("pt-[70px]");
    expect(screen.getByTestId("change-password-logo").querySelector("img")?.getAttribute("src")).toBe("/midcon-square.png");

    for (const testId of ["input-change-password-new", "input-change-password-confirm"]) {
      const field = screen.getByTestId(testId);
      expect(field.className).toContain("rounded-xl");
      expect(field.className).toContain("border-2");
      expect(field.className).toContain("bg-white");
      expect(field.className).toContain("text-gray-700");
      expect(field.getAttribute("style")).toContain("border-color");
    }

    const submit = screen.getByTestId("button-change-password-submit");
    expect([...submit.querySelectorAll("img")].some((image) => image.getAttribute("src") === brandImagePillSrc("#3260cd", "MidCon Solutions"))).toBe(true);
  });
});