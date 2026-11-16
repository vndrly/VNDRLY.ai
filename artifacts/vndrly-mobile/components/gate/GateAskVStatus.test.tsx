import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

it("confirms the server-bound readback and always lets the operator stop V", () => {
  const screen = render(<GateAskVStatus />);
  fireEvent.click(screen.getByText("Confirm", { exact: true }));
  expect(voice.assistant.send).toHaveBeenCalledWith("Confirmed", "ios_text", "server-confirmation");
  fireEvent.click(screen.getByText("Stop V"));
  expect(voice.setMuted).toHaveBeenCalledWith(true);
  voice.assistant.streaming = true;
  screen.rerender(<GateAskVStatus />);
  expect(screen.queryByText("Confirm", { exact: true })).toBeNull();
  voice.muted = true;
  screen.rerender(<GateAskVStatus />);
  expect(screen.queryByTestId("gate-askv-status")).toBeNull();
});
