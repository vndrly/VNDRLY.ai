import { registerGateVoiceForm, notifyGateVoiceDraftChanged } from "@workspace/gate-booth";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ startHelper: vi.fn(() => true), startVoice: vi.fn(), sendText: vi.fn(), state: "listening", page: "/gate" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorRole: "office", vendorId: 22 } }) }));
vi.mock("./next-steps", () => ({ useNextSteps: () => ({ enabled: true, scope: "22:7", count: 0, selected: null, startHelper: env.startHelper }) }));
vi.mock("wouter", () => ({ useLocation: () => [env.page, vi.fn()] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./askv-status-indicator", () => ({ default: () => <span data-testid="voice-modulator"/> }));
vi.mock("./askv-logo", () => ({ AskVFloatingLauncherMark: () => null, ASKV_LAUNCHER_HEIGHT: 32, ASKV_LAUNCHER_WIDTH: 64 }));
vi.mock("./assistant-markdown", () => ({ AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => ({ state: env.state, focusMode: true, sendText: env.sendText, startConversation: env.startVoice, muted: false, setMuted: vi.fn(), closePanel: vi.fn(), assistant: { messages: [
  { id: "u1", role: "user", content: "Guide this check-in" },
  { id: "a1", role: "assistant", content: "I can guide you", gateWorkflowOffer: { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: { siteId: 9 } } },
] } }) }));
import { registerGateHelper } from "@/lib/gate-helper-registry";
import CombinedAskVControl, { AskVCompanion as AskVTopPane } from "./askv-top-pane";
import {selectGuidance} from "./guidance-surface";
beforeEach(()=>{env.state="listening";env.page="/gate";env.startVoice.mockClear();env.startHelper.mockClear();selectGuidance("askv");});
afterEach(()=>{cleanup();window.history.replaceState({},"","/");});
function mountOpen(){const view=render(<><CombinedAskVControl/><AskVTopPane/></>);fireEvent.click(screen.getByTestId("assistant-launcher"));return view;}
it("shows only the requested check-in summary inside the header during voice capture", async () => {
 const unregister=registerGateVoiceForm({read:()=>({silentCheckIn:true,siteLocationId:9,firstName:"Matt",lastName:"Smith",company:"Matt's Trucking",plateState:"OK",vehiclePlate:"ABC123"}),saved:()=>{}});
 try {
  render(<><CombinedAskVControl/><AskVTopPane/></>);await act(async()=>{});
  const summary=screen.getByTestId("askv-live-check-in");
  expect(screen.getByTestId("askv-pane").contains(summary)).toBe(true);
  expect(Array.from(summary.children).map(child=>child.textContent)).toEqual(["Check in:","Matt Smith","Matt's Trucking","OK ABC123","Confirm?"]);
  expect(screen.queryByText("More")).toBeNull();
  expect(screen.queryByTestId("askv-top-reply")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Confirm?"}));
  expect(env.sendText).toHaveBeenCalledWith("confirm");
 }finally{await act(async()=>unregister());}
});
it("shows the pending checkout visitor in the header and confirms through voice", async () => {
 const unregister=registerGateVoiceForm({read:()=>({siteLocationId:9,checkoutReview:{firstName:"John",lastName:"Smith",company:"John's Trucking",plateState:"OK",vehiclePlate:"ABC123"}}),saved:()=>{}});
 try {
  render(<><CombinedAskVControl/><AskVTopPane/></>);await act(async()=>{});
  const summary=screen.getByTestId("askv-live-check-in");
  expect(Array.from(summary.children).map(child=>child.textContent)).toEqual(["Check out:","John Smith","John's Trucking","OK ABC123","Confirm?"]);
  fireEvent.click(screen.getByRole("button",{name:"Confirm?"}));
  expect(env.sendText).toHaveBeenCalledWith("confirm");
 }finally{await act(async()=>unregister());}
});
it("renders the interaction inside the existing top AskV pane", () => {
 mountOpen();
 expect(screen.getByTestId("askv-pane").contains(screen.getByTestId("askv-top-conversation"))).toBe(true);
 expect(screen.queryByRole("textbox", { name: "Message AskV" })).toBeNull();
});
it('does not open a shared panel merely because voice is listening',()=>{
 render(<AskVTopPane/>);
 expect(screen.queryByTestId('askv-top-conversation')).toBeNull();
});
it('does not start the microphone when a restored Gate check-in form mounts or remounts',async()=>{
 window.history.replaceState({},'', '/gate');
 const unregister=registerGateVoiceForm({read:()=>({voiceMode:'check-in',firstName:'Saved',vehiclePlate:'TEST123'}),saved:()=>{}});
 try{
  const first = render(<AskVTopPane/>);await act(async()=>{});
  expect(env.startVoice).not.toHaveBeenCalled();
  first.unmount();
  render(<AskVTopPane/>);await act(async()=>{});
  expect(env.startVoice).not.toHaveBeenCalled();
  expect(screen.queryByTestId('askv-top-conversation')).toBeNull();
 }finally{await act(async()=>unregister());window.history.replaceState({},'', '/');}
});
it("retains the AskV reply when switching to Next Steps and back",()=>{
 mountOpen();

 act(()=>selectGuidance("steps"));
 expect(screen.queryByRole('textbox',{name:'Message AskV'})).toBeNull();
 fireEvent.click(screen.getByTestId("assistant-launcher"));
 expect(screen.getByText("I can guide you")).toBeTruthy();
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
  mountOpen();
  expect(env.startHelper).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start guided helper" }));
  expect(env.startHelper).toHaveBeenCalledWith("gate-vehicle-check-in", expect.objectContaining({ siteId: 9 }));
});
it("keeps the operator's current check-in turn visible beside V's reply in Focus mode", () => {
  mountOpen();
  expect(screen.getByText("Guide this check-in").textContent).toBe("Guide this check-in");
  expect(screen.getByText("I can guide you").textContent).toBe("I can guide you");
});


it("keeps focus entry quiet, and mirrors the form only after AskV is opened", async () => {
 window.history.replaceState({}, "", "/gate");
 let draft = {voiceMode:"check-in", firstName:"Alex", vehiclePlate:"TEST123", plateState:"OK"};
 const unregister=registerGateVoiceForm({read:()=>draft,saved:()=>{}});
 const view=render(<><CombinedAskVControl/><AskVTopPane/></>);
 await act(async()=>{});
 expect(screen.queryByTestId("askv-top-conversation")).toBeNull();
 fireEvent.click(screen.getByTestId("assistant-launcher"));
 expect(screen.getByTestId("askv-live-check-in").textContent).toContain("TEST123");
 expect(env.startVoice).toHaveBeenCalled();
 await act(async()=>{draft={...draft,vehiclePlate:"EDIT456"};notifyGateVoiceDraftChanged();});
 expect(screen.getByTestId("askv-live-check-in").textContent).toContain("EDIT456");
 fireEvent.click(screen.getByRole("button",{name:"Close AskV"}));
 await act(async()=>{draft={...draft,firstName:"Changed"};notifyGateVoiceDraftChanged();});
 for(const state of ["thinking","speaking","listening"]){env.state=state;view.rerender(<><CombinedAskVControl/><AskVTopPane/></>);expect(screen.queryByTestId("askv-top-conversation")).toBeNull();}
 await act(async()=>unregister());
 expect(screen.queryByTestId("askv-live-check-in")).toBeNull();
 window.history.replaceState({}, "", "/");
});

it("keeps passive native replies quiet and closes an explicitly opened conversation on navigation",()=>{
 const view=render(<><CombinedAskVControl/><AskVTopPane/></>);
 act(()=>window.dispatchEvent(new CustomEvent("gate-companion-state",{detail:{message:"Native reply"}})));
 expect(screen.queryByTestId("askv-top-conversation")).toBeNull();
 fireEvent.click(screen.getByTestId("assistant-launcher"));
 expect(screen.getByTestId("askv-top-conversation")).toBeTruthy();
 env.page="/gate/map";view.rerender(<><CombinedAskVControl/><AskVTopPane/></>);
 expect(screen.queryByTestId("askv-top-conversation")).toBeNull();
});

it("preserves an explicitly opened AskV panel between Work Hub pages", () => {
 env.page = "/work-hub/calendar";
 const view = mountOpen();

 for (const path of ["/work-hub/profile", "/work-hub/chat", "/work-hub", "/work-hub/library/123"]) {
   env.page = path;
   view.rerender(<><CombinedAskVControl/><AskVTopPane/></>);
   expect(screen.getByTestId("askv-top-conversation")).toBeTruthy();
   expect(screen.queryByRole("textbox", { name: "Message AskV" })).toBeNull();
 }
 fireEvent.click(screen.getByRole("button", { name: "Close AskV" }));
 env.page = "/work-hub/settings";
 view.rerender(<><CombinedAskVControl/><AskVTopPane/></>);
 expect(screen.queryByTestId("askv-top-conversation")).toBeNull();
});
