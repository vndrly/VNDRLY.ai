import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GateNativeHeaderBridge } from "./gate-native-header-bridge";

const state = vi.hoisted(() => ({ enabled: true, count: 3, open: false, show: vi.fn(), close: vi.fn() }));
vi.mock("./next-steps", () => ({ useNextSteps: () => state }));
afterEach(() => { cleanup(); vi.clearAllMocks(); state.open = false; });

describe("native Gate header bridge", () => {
  it("reports the current page state and toggles that page's helper", () => {
    const postMessage = vi.fn();
    Object.assign(window, { ReactNativeWebView: { postMessage } });
    const screen = render(<GateNativeHeaderBridge />);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: "gate-next-steps-state", enabled: true, count: 3, open: false });
    window.dispatchEvent(new Event("gate-next-steps-toggle"));
    expect(state.show).toHaveBeenCalledOnce();
    state.open = true;
    window.dispatchEvent(new Event("gate-next-steps-toggle"));
    expect(state.close).toHaveBeenCalledOnce();
    screen.unmount();
    window.dispatchEvent(new Event("gate-next-steps-toggle"));
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("ignores commands from unrelated frames", () => {
    render(<GateNativeHeaderBridge />);
    window.dispatchEvent(new MessageEvent("message", { origin: "https://untrusted.example", data: { type: "gate-next-steps-toggle" } }));
    expect(state.show).not.toHaveBeenCalled();
  });
});
