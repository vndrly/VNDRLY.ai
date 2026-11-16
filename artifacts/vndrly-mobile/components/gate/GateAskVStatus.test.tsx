import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateAskVStatus from "./GateAskVStatus";

const voice = vi.hoisted(() => ({ muted: false, state: "listening", error: null,
  setMuted: vi.fn(), assistant: { streaming: false, send: vi.fn(), messages: [
    { role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" },
  ] } }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => voice }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8" }) }));
vi.mock("./GateChrome", () => ({ useGateCopy: () => (en: string) => en }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); voice.muted = false; voice.state = "listening"; voice.assistant.streaming = false; voice.assistant.messages = [{ role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" }]; });

it("confirms the server-bound readback and always lets the operator stop V", () => {
  const screen = render(<GateAskVStatus />);
  fireEvent.click(screen.getByText("Submit", { exact: true }));
  expect(voice.assistant.send).toHaveBeenCalledWith("Confirmed", "ios_text", "server-confirmation");
  fireEvent.click(screen.getByText("Stop V"));
  expect(voice.setMuted).toHaveBeenCalledWith(true);
  voice.assistant.streaming = true;
  screen.rerender(<GateAskVStatus />);
  expect(screen.queryByText("Submit", { exact: true })).toBeNull();
  voice.muted = true;
  screen.rerender(<GateAskVStatus />);
  expect(screen.queryByTestId("gate-askv-status")).toBeNull();
});

it.each(["connecting", "listening"])("keeps %s and Stop V in one compact row", state => {
  voice.muted = false;
  voice.state = state;
  voice.assistant.messages = [];
  const screen = render(<GateAskVStatus />);
  const row = screen.getByTestId("gate-askv-status");
  expect(row.style.flexDirection).toBe("row");
  expect(screen.getByText(state === "connecting" ? "Connecting to V…" : "V is listening.")).toBeTruthy();
  fireEvent.click(screen.getByText("Stop V"));
  expect(voice.setMuted).toHaveBeenCalledWith(true);
});

it("closes only the panel and reopens on a new crossing exchange", () => {
 const screen = render(<GateAskVStatus />);
 fireEvent.click(screen.getByText("Close panel"));
 expect(screen.queryByTestId("gate-askv-status")).toBeNull();
 expect(voice.setMuted).not.toHaveBeenCalled();
 voice.assistant.messages = [...voice.assistant.messages, { role: "user", content: "V check in Jane Doe", pending: false, confirmationReference: "" }];
 screen.rerender(<GateAskVStatus />);
 expect(screen.getByTestId("gate-askv-status")).toBeTruthy();
});
it("stages optional details for a new readback instead of confirming the old draft", async () => {
 const screen = render(<GateAskVStatus />);
 fireEvent.change(screen.getByLabelText("Any other details?"), {target:{value:"Delivering supplies"}});
 fireEvent.click(screen.getByText("Review details"));
 expect(voice.assistant.send).toHaveBeenCalledWith("Update this pending crossing with these additional details: Delivering supplies", "ios_text");
});
