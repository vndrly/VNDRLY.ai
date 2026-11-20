import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { gateCheckInBinding, registerGateVoiceForm, notifyGateVoiceDraftChanged } from "@workspace/gate-booth";
import { GateNativeVoiceBridge } from "./gate-native-voice-bridge";
const env = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7 } }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => env }));
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.clearAllMocks(); });
it("publishes the current form and acknowledges only commands bound to this page", () => {
  window.history.replaceState(null, "", "/gate");
  const postMessage = vi.fn(), saved = vi.fn(), prefill = vi.fn();
  Object.assign(window, { ReactNativeWebView: { postMessage } });
  const unregister = registerGateVoiceForm({ read: () => ({ firstName: "Ana", siteLocationId: 9 }), saved });
  window.addEventListener("askv:gate-prefill", prefill);
  try {
    const screen = render(<GateNativeVoiceBridge />);
    const message = JSON.parse(postMessage.mock.calls[0][0]);
    expect(message).toMatchObject({ userId: 7, draft: { firstName: "Ana", siteLocationId: 9 } });
    const command = { type: "gate-askv-command", pageId: message.pageId, requestId: "1", action: "prefill", values: { values: { lastName: "Reed" } } };
    window.dispatchEvent(new MessageEvent("message", { origin: "https://wrong.test", data: command }));
    expect(prefill).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent("gate-askv-command", { detail: { ...command, pageId: "old" } }));
    expect(prefill).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent("gate-askv-command", { detail: command }));
    expect(prefill).toHaveBeenCalledOnce();
    expect(JSON.parse(postMessage.mock.calls.at(-1)![0]).requestId).toBe("1");
    screen.unmount(); postMessage.mockClear(); notifyGateVoiceDraftChanged(); expect(postMessage).not.toHaveBeenCalled();
  } finally { unregister(); window.removeEventListener("askv:gate-prefill", prefill); }
});

it("opens and fills the iPad form only for its current gate and visit draft", () => {
  window.history.replaceState(null, "", "/gate");
  const postMessage = vi.fn(), open = vi.fn(), fillCheckIn = vi.fn();
  Object.assign(window, { ReactNativeWebView: { postMessage } });
  const draft = { siteLocationId: 9, gateStationId: "gate-a", entryRevision: 1 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: vi.fn(), open, fillCheckIn });
  try {
    render(<GateNativeVoiceBridge />);
    const { pageId } = JSON.parse(postMessage.mock.calls[0][0]);
    const command = { type: "gate-askv-command", pageId, binding: gateCheckInBinding(draft) };
    const receive = (action: string, values?: unknown) => window.dispatchEvent(new CustomEvent("gate-askv-command", { detail: { ...command, action, values } }));
    receive("open-check-in");
    receive("fill-check-in", { firstName: "Ana" });
    draft.entryRevision++;
    receive("fill-check-in", { firstName: "Previous Visitor" });
    expect(open).toHaveBeenCalledOnce();
    expect(fillCheckIn).toHaveBeenCalledExactlyOnceWith({ firstName: "Ana" });
  } finally { unregister(); }
});

