import { registerGateVoiceForm, notifyGateVoiceDraftChanged } from "@workspace/gate-booth";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ startHelper: vi.fn(() => true), startVoice: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorRole: "office", vendorId: 22 } }) }));
vi.mock("./next-steps", () => ({ useNextSteps: () => ({ enabled: true, scope: "22:7", count: 0, selected: null, startHelper: env.startHelper }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/gate", vi.fn()] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./askv-status-indicator", () => ({ default: () => <span data-testid="voice-modulator"/> }));
vi.mock("./askv-logo", () => ({ AskVFloatingLauncherMark: () => null, ASKV_LAUNCHER_HEIGHT: 32, ASKV_LAUNCHER_WIDTH: 64 }));
vi.mock("./assistant-markdown", () => ({ AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => ({ state: "listening", focusMode: true, startConversation: env.startVoice, muted: false, setMuted: vi.fn(), closePanel: vi.fn(), assistant: { messages: [
  { id: "u1", role: "user", content: "Guide this check-in" },
  { id: "a1", role: "assistant", content: "I can guide you", gateWorkflowOffer: { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: { siteId: 9 } } },
] } }) }));
import { registerGateHelper } from "@/lib/gate-helper-registry";
import CombinedAskVControl, { AskVCompanion as AskVTopPane } from "./askv-top-pane";
import {selectGuidance} from "./guidance-surface";
it("retains the AskV draft when switching to Next Steps and back",()=>{
 render(<AskVTopPane/>);
 fireEvent.change(screen.getByLabelText('Message AskV'),{target:{value:'Keep this question'}});
 fireEvent.click(screen.getByRole('button',{name:'Next Steps'}));
 expect(screen.queryByRole('textbox',{name:'Message AskV'})).toBeNull();
 act(()=>{selectGuidance('askv');window.dispatchEvent(new Event('vndrly-guidance-askv'));});
 expect((screen.getByLabelText('Message AskV') as HTMLInputElement).value).toBe('Keep this question');
});
it("keeps the launcher and voice modulator inside one positioned control",()=>{
 render(<CombinedAskVControl/>);
 const combined=screen.getByTestId('askv-combined-control');
 expect(combined.classList.contains('relative')).toBe(true);
 expect(combined.contains(screen.getByTestId('assistant-launcher'))).toBe(true);
 expect(combined.contains(screen.getByTestId('voice-modulator'))).toBe(true);
});
it("starts the existing Next Steps helper directly from the spoken reply strip", () => {
  registerGateHelper({ key: "gate-vehicle-check-in", title: "Check in a vehicle", description: "Guide the saved visit", access: "gate", keywords: ["check in"], create: () => null });
  render(<AskVTopPane />);
  expect(env.startHelper).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start guided helper" }));
  expect(env.startHelper).toHaveBeenCalledWith("gate-vehicle-check-in", expect.objectContaining({ siteId: 9 }));
});
it("keeps the operator's current check-in turn visible beside V's reply in Focus mode", () => {
  render(<AskVTopPane />);
  expect(screen.getByText("Guide this check-in").textContent).toBe("Guide this check-in");
  expect(screen.getByText("I can guide you").textContent).toBe("I can guide you");
});


it("opens focus on entry and mirrors the current form without a confirmation click", async () => {
 window.history.replaceState({}, "", "/gate");
 let draft = {voiceMode:"check-in", firstName:"Alex", vehiclePlate:"TEST123", plateState:"OK"};
 const unregister=registerGateVoiceForm({read:()=>draft,saved:()=>{}});
 render(<AskVTopPane/>);
 await act(async()=>{});
 expect(screen.getByTestId("askv-live-check-in").textContent).toContain("TEST123");
 expect(env.startVoice).toHaveBeenCalled();
 await act(async()=>{draft={...draft,vehiclePlate:"EDIT456"};notifyGateVoiceDraftChanged();});
 expect(screen.getByTestId("askv-live-check-in").textContent).toContain("EDIT456");
 await act(async()=>unregister());
 expect(screen.queryByTestId("askv-live-check-in")).toBeNull();
 window.history.replaceState({}, "", "/");
});
