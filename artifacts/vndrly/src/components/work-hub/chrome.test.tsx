import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";
import { BrandedInput, BrandedSelect, WorkHubPageHeading, WorkHubSurface } from "./chrome";

describe("Work Hub surface branding", () => {
  it("uses one compact branded geometry for text inputs and dropdowns", () => {
    render(<><BrandedInput aria-label="Standard input" /><BrandedSelect aria-label="Standard select"><option>All</option></BrandedSelect></>);

    for (const control of [screen.getByLabelText("Standard input"), screen.getByLabelText("Standard select")]) {
      expect(control.className).toContain("h-9");
      expect(control.className).toContain("rounded-full");
      expect(control.className).toContain("border-2");
      expect(control.className).toContain("border-[color:var(--brand-primary)]");
      expect(control.className).toContain("bg-white");
    }
  });
  it("brands declared cards without overriding semantic notice borders", () => {
    render(
      <WorkHubSurface>
        <Card data-testid="card" />
        <p data-testid="warning" className="rounded-lg border border-amber-400">
          Warning
        </p>
      </WorkHubSurface>,
    );

    const surface = screen.getByTestId("card").parentElement;
    expect(surface?.className).toContain("[&_[data-slot=card]]");
    expect(surface?.className).not.toContain("[&_.rounded-lg.border]");
    expect(screen.getByTestId("warning").className).toContain("border-amber-400");
  });

  it("uses the standard back control with a branded icon and black aligned title", () => {
    render(
      <WorkHubPageHeading
        module="activity"
        title="Activity"
        description="Recent conversations"
        backFallbackHref="/"
      />,
    );

    expect(screen.getByTestId("button-back")).toBeTruthy();
    const heading = screen.getByRole("heading", { name: "Activity" });
    expect(heading.className).toContain("text-black");
    expect(heading.closest("header")?.className).toContain("items-center");
    expect(heading.closest("header")?.querySelector('[data-work-hub-heading-icon="activity"]')?.getAttribute("class")).toContain("text-[var(--brand-primary)]");
  });
});
