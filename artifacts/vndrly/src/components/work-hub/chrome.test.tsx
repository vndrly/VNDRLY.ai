import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";
import { WorkHubSurface } from "./chrome";

describe("Work Hub surface branding", () => {
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
});
