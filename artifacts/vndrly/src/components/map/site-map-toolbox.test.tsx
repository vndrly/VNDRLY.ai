import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const startConversation = vi.fn();
const sendText = vi.fn();
vi.mock("@/hooks/use-askv-voice-session", () => ({
  useAskVVoiceSession: () => ({ startConversation, sendText, muted: true }),
}));

import SiteMapToolbox from "./site-map-toolbox";

it("sends the selected site as context with a beginner AskV prompt", () => {
  render(<SiteMapToolbox siteName="Moseley Pad" />);
  fireEvent.click(screen.getByRole("button", { name: "Who is on site?" }));
  expect(sendText).toHaveBeenCalledWith("Who is currently on site at Moseley Pad?");
});
