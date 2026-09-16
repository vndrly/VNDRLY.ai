import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canNavigateBackInApp,
  installInAppNavigationTracking,
  navigateBackInApp,
} from "./in-app-navigation";

describe("in-app page back navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    installInAppNavigationTracking();
    window.history.replaceState({}, "", "/");
  });

  it("uses the safe fallback when the current tab has no VNDRLY history", () => {
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/work-hub/activity");
    expect(navigate).toHaveBeenCalledWith("/work-hub/activity", { replace: true });
  });

  it("uses browser back after a VNDRLY route was pushed", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const navigate = vi.fn();
    window.history.pushState({}, "", "/work-hub/files");
    expect(canNavigateBackInApp()).toBe(true);
    navigateBackInApp(navigate, "/work-hub/activity");
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    back.mockRestore();
  });
});
