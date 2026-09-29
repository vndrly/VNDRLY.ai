import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRAND } from "@/hooks/use-brand";
import { OnboardingPageShell } from "./onboarding-page-shell";


vi.mock("@/components/language-toggle", () => ({
  default: () => <div data-testid="language-toggle-mock" />,
}));

vi.mock("@/components/nav-pane-halftone-background", () => ({
  NavPaneHalftoneBackground: ({ enabled }: { enabled?: boolean }) =>
    enabled ? <div data-testid="halftone-mock" /> : null,
}));

describe("OnboardingPageShell", () => {
  it("uses the standard VNDRLY dark treatment without an appearance switch", () => {
    render(
      <OnboardingPageShell brand={DEFAULT_BRAND}>
        <div>Wizard content</div>
      </OnboardingPageShell>,
    );

    const shell = screen.getByTestId("onboarding-page-shell");
    expect(shell.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("halftone-mock")).toBeTruthy();
    expect(screen.getByTestId("language-toggle-mock")).toBeTruthy();
    expect(screen.getByText("Wizard content")).toBeTruthy();

    expect(screen.queryByTestId("dark-light-toggle")).toBeNull();
  });
});
