import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ startHelper: vi.fn(() => true) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorRole: "office", vendorId: 22 } }) }));
vi.mock("./next-steps", () => ({ useNextSteps: () => ({ enabled: true, scope: "22:7", count: 0, selected: null, startHelper: env.startHelper }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/gate", vi.fn()] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./askv-status-indicator", () => ({ default: () => null }));
vi.mock("./askv-logo", () => ({ AskVFloatingLauncherMark: () => null, ASKV_LAUNCHER_HEIGHT: 32, ASKV_LAUNCHER_WIDTH: 64 }));
vi.mock("./assistant-markdown", () => ({ AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => ({ state: "listening", muted: false, setMuted: vi.fn(), closePanel: vi.fn(), assistant: { messages: [
  { id: "u1", role: "user", content: "Guide this check-in" },
  { id: "a1", role: "assistant", content: "I can guide you", gateWorkflowOffer: { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: { siteId: 9 } } },
] } }) }));
import { registerGateHelper } from "@/lib/gate-helper-registry";
import AskVTopPane from "./askv-top-pane";
it("starts the existing Next Steps helper directly from the spoken reply strip", () => {
  registerGateHelper({ key: "gate-vehicle-check-in", title: "Check in a vehicle", description: "Guide the saved visit", access: "gate", keywords: ["check in"], create: () => null });
  render(<AskVTopPane />);
  expect(env.startHelper).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start guided helper" }));
  expect(env.startHelper).toHaveBeenCalledWith("gate-vehicle-check-in", expect.objectContaining({ siteId: 9 }));
});
