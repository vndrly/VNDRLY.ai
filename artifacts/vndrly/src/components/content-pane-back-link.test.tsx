import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ContentPaneBackLink from "./content-pane-back-link";
import { canNavigateBackInApp, installInAppNavigationTracking } from "@/lib/in-app-navigation";

const nativePush = window.history.pushState.bind(window.history);
const nativeReplace = window.history.replaceState.bind(window.history);
function resetTracking() {
  window.history.pushState = nativePush;
  window.history.replaceState = nativeReplace;
  delete (window as Window & { __vndrlyNavigationTrackingInstalled?: boolean }).__vndrlyNavigationTrackingInstalled;
}
beforeEach(() => {
  resetTracking();
  nativeReplace({}, "", "/work-hub/calendar?day=2026-10-22#agenda");
  vi.spyOn(document, "referrer", "get").mockReturnValue("");
  installInAppNavigationTracking();
});
afterEach(() => { cleanup(); resetTracking(); vi.restoreAllMocks(); });

it("uses the previous browser page instead of jumping to the supplied parent fallback", async () => {
  window.history.pushState({}, "", "/gate/change-over?siteId=4&stationId=north");
  render(<ContentPaneBackLink href="/work-hub" />);
  fireEvent.click(screen.getByTestId("button-back"));
  await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash).toBe("/work-hub/calendar?day=2026-10-22#agenda"));
});

it("uses a replace fallback on direct entry so Back cannot loop to the same dashboard", async () => {
  window.history.replaceState({}, "", "/gate/change-over?siteId=4");
  render(<ContentPaneBackLink href="/work-hub" />);
  fireEvent.click(screen.getByTestId("button-back"));
  await waitFor(() => expect(window.location.pathname).toBe("/work-hub"));
  expect(canNavigateBackInApp()).toBe(false);
});

it("preserves an explicit action callback without also navigating", () => {
  window.history.pushState({}, "", "/gate/change-over?siteId=4");
  const onClick = vi.fn();
  const back = vi.spyOn(window.history, "back");
  render(<ContentPaneBackLink href="/work-hub" onClick={onClick} />);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/gate/change-over");
});
