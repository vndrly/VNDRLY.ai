import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { SitePresence } from "./site-presence";
it("does not turn unavailable data into an empty presence result", () => {
  render(<SitePresence snapshot={null} loading={false} sites={[]} recordHref={() => "/gate/history"} />);
  expect(screen.getByText("Site presence records unavailable.")).toBeTruthy();
  expect(screen.queryByText("No people are currently recorded on site.")).toBeNull();
});
