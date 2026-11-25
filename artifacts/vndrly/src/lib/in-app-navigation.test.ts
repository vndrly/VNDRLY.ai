import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import {
  canNavigateBackInApp,
  installInAppNavigationTracking,
  navigateBackInApp,
} from "./in-app-navigation";

const nativePush = window.history.pushState.bind(window.history);
const nativeReplace = window.history.replaceState.bind(window.history);
const resetTracking = () => {
  window.history.pushState = nativePush;
  window.history.replaceState = nativeReplace;
  delete (window as Window & { __vndrlyNavigationTrackingInstalled?: boolean }).__vndrlyNavigationTrackingInstalled;
};

describe("in-app page back navigation", () => {
  beforeEach(() => {
    resetTracking();
    nativeReplace({}, "", "/work-hub/calendar?day=2026-10-22#agenda");
    vi.spyOn(document, "referrer", "get").mockReturnValue("");
    installInAppNavigationTracking();
  });
  afterEach(() => { resetTracking(); vi.restoreAllMocks(); });

  it("does not invent a previous page when the current tab has no VNDRLY history", () => {
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/work-hub/activity");
    expect(navigate).not.toHaveBeenCalled();
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

  it("returns to the actual prior page including its query and fragment", async () => {
    window.history.pushState({ routeState: "keep" }, "", "/gate/change-over?siteId=4&stationId=north");
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/work-hub");
    await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash).toBe("/work-hub/calendar?day=2026-10-22#agenda"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not strand Back on duplicate pushes of the current page", async () => {
    window.history.pushState({}, "", "/gate/change-over?siteId=4");
    window.history.pushState({ updatedSelection: true }, "", "/gate/change-over?siteId=4");
    expect(window.history.state.updatedSelection).toBe(true);
    navigateBackInApp(vi.fn(), "/work-hub");
    await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash).toBe("/work-hub/calendar?day=2026-10-22#agenda"));
  });

  it("recognizes a previous same-origin full-page navigation", async () => {
    resetTracking();
    vi.spyOn(document, "referrer", "get").mockReturnValue(`${window.location.origin}/work-hub/calendar?day=2026-10-22#agenda`);
    nativePush({}, "", "/gate/change-over?siteId=4");
    installInAppNavigationTracking();
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/work-hub");
    await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash).toBe("/work-hub/calendar?day=2026-10-22#agenda"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not send an externally deep-linked user back outside VNDRLY", () => {
    resetTracking();
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://external.example/dispatch");
    nativePush({}, "", "/gate/change-over?siteId=4");
    installInAppNavigationTracking();
    const back = vi.spyOn(window.history, "back");
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/work-hub");
    expect(back).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns embedded iPhone pages through the native stack instead of a web fallback", () => {
    window.history.replaceState({}, "", "/gate/map?gateDashboardEmbed=1&gateBackBridge=1&gateVoiceChannel=current-page");
    const postMessage = vi.fn();
    const host = window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } };
    host.ReactNativeWebView = { postMessage };
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const navigate = vi.fn();
    try {
      navigateBackInApp(navigate, "/gate/change-over");
      expect(postMessage).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "gate-page-back", channel: "current-page" }));
      expect(back).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally { delete host.ReactNativeWebView; }
  });

  it("returns the iPhone web preview through its parent navigation", () => {
    window.history.replaceState({}, "", "/gate/history?gateDashboardEmbed=1&gateBackBridge=1&gateVoiceChannel=preview-page");
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    vi.spyOn(document, "referrer", "get").mockReturnValue("http://localhost:8081/gate-map");
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/gate/change-over");
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "gate-page-back", channel: "preview-page" }, "http://localhost:8081");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns the iPhone web preview when it was opened as 127.0.0.1", () => {
    window.history.replaceState({}, "", "/gate/history?gateDashboardEmbed=1&gateBackBridge=1&gateVoiceChannel=preview-page");
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://127.0.0.1:8081/change-over");
    const navigate = vi.fn();
    navigateBackInApp(navigate, "/gate/change-over");
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "gate-page-back", channel: "preview-page" }, "https://127.0.0.1:8081");
    expect(navigate).not.toHaveBeenCalled();
  });
});
