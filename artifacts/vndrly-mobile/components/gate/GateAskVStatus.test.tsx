import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateAskVStatus from "./GateAskVStatus";
vi.mock("expo-router", () => ({ router: {push: vi.fn()} }));
vi.mock("@/lib/api", () => ({getApiBase:()=>"https://example.test"}));
vi.mock("@/lib/askv-client-tools", () => ({openAuthorizedAssistantLink:vi.fn()}));
// Embedded Gate pages must keep the native top readback even with shared guidance registered.
vi.mock("./GateHeaderActions", () => ({ useGateHeaderActions: () => ({ sharedCompanion: true }) }));

vi.mock("@/components/AskVConversation", () => ({ default: ({onClose}: any) => <button onClick={onClose}>Conversation back</button> }));
vi.mock("@/components/DismissibleModal", () => ({ default: ({visible, children}: any) => visible ? <div data-testid="v-dialogue">{children}</div> : null }));
const voice = vi.hoisted(() => ({ muted: false, state: "listening", error: null,
  checkInReview: null as ReturnType<typeof import("@/hooks/use-askv-voice-session").useAskVVoiceSession>["checkInReview"],
  shiftNoteDraft: null as ReturnType<typeof import("@/hooks/use-askv-voice-session").useAskVVoiceSession>["shiftNoteDraft"],
  checkInSaving: false, checkInError: null, confirmCheckIn: vi.fn(), sendShiftNoteText: vi.fn(),
  setMuted: vi.fn(), assistant: { streaming: false, send: vi.fn(), messages: [
    { role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" },
  ] } }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => voice }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8" }) }));
vi.mock("./GateChrome", () => ({ useGateCopy: () => (en: string) => en }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); voice.checkInReview = null; voice.shiftNoteDraft = null; voice.muted = false; voice.state = "listening"; voice.assistant.streaming = false; voice.assistant.messages = [{ role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" }]; });
it("renders tables and tool-backed comparisons inside the top pane", () => {
 voice.assistant.messages = [{role:"assistant",content:"| Site | Visits |\n| --- | --- |\n| North | 12 |",pending:false,toolCalls:["last_year","ytd"].map((preset,index)=>({name:"query_revenue_summary",input:{preset,breakdown:"site"},output:JSON.stringify({role:"vendor",preset,breakdown:"site",periodLabel:index?"2026 YTD":"2025",rows:[{siteName:"North",amount:index?"20":"10"}]})}))}] as any;
 const view=render(<GateAskVStatus gatePage={false}/>);
 expect(view.getByText("Visits")).toBeTruthy();
 expect(view.getByTestId("askv-revenue-comparison")).toBeTruthy();
});
it("hides an unfinished check-in when disengaged and preserves the review", () => {
 voice.checkInReview={key:"review",firstName:"Jo",lastName:"Perez",company:"Example",vehiclePlate:"ABC123",plateState:"OK",destinationName:"",destinationNeedsReview:false,details:[],ready:true};
 const view=render(<GateAskVStatus/>);
 fireEvent.change(view.getByLabelText("Gate details or correction"),{target:{value:"Last name Smith"}});
 fireEvent.click(view.getByText("Send to V"));
 expect(voice.assistant.send).toHaveBeenCalledWith("Last name Smith","ios_text",undefined,true);
 voice.muted=true; view.rerender(<GateAskVStatus/>);
 expect(view.queryByTestId("gate-askv-check-in")).toBeNull();
 voice.muted=false; view.rerender(<GateAskVStatus/>);
 expect(view.getByTestId("gate-askv-check-in")).toBeTruthy();
});

it("shows the exact shift note in the top panel and hides generic submit", () => {
  voice.shiftNoteDraft = { text: "Barrier damaged at 5:15", status: "ready" };
  const screen = render(<GateAskVStatus />);
  expect(screen.getByText("Shift note: Barrier damaged at 5:15 Confirm?")).toBeTruthy();
  expect(screen.queryByText("Submit", { exact: true })).toBeNull();
});
it("routes typed shift-note corrections through the same draft flow", () => {
  voice.shiftNoteDraft = { text: "Barrier damaged at 5:15", status: "ready" };
  const screen = render(<GateAskVStatus />);
  fireEvent.change(screen.getByLabelText("Ask V on this page"), { target: { value: "Change 5:15 to 5:50" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to V" }));
  expect(voice.sendShiftNoteText).toHaveBeenCalledWith("Change 5:15 to 5:50");
  expect(voice.assistant.send).not.toHaveBeenCalled();
});
it("keeps a shift-note draft visible during transient voice inactivity", () => {
  voice.shiftNoteDraft = { text: "Barrier damaged at 5:15", status: "ready" };
  voice.state = "stopped";
  const screen = render(<GateAskVStatus />);
  expect(screen.getByText("Shift note: Barrier damaged at 5:15 Confirm?")).toBeTruthy();
});

it("shows the check-in in review order and confirms the displayed draft on tap", () => {
  voice.checkInReview = { key: "review", firstName: "John", lastName: "Elleryk", company: "John's Trucking", vehiclePlate: "ABC123", plateState: "OK", destinationName: "Wildcat 2", destinationNeedsReview: false, details: ["Red truck"], ready: true };
  const screen = render(<GateAskVStatus />);
  expect(screen.getByTestId("gate-askv-check-in").textContent).toBe("Check inJohn EllerykJohn's TruckingABC123 · OKWildcat 2Red truckSend to VConfirmClose");
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(voice.confirmCheckIn).toHaveBeenCalledExactlyOnceWith("review");
  expect(voice.assistant.send).not.toHaveBeenCalled();
});

it("confirms the server-bound readback and always lets the operator stop V", () => {
  const screen = render(<GateAskVStatus />);
  fireEvent.click(screen.getByText("Submit", { exact: true }));
  expect(voice.assistant.send).toHaveBeenCalledWith("Confirmed", "ios_text", "server-confirmation", true);
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

it("disengages when closed and stays closed across navigation until re-engaged", () => {
 const screen = render(<GateAskVStatus pagePath="/gate" />);
 fireEvent.click(screen.getByText("Close"));
 expect(voice.setMuted).toHaveBeenCalledWith(true);
 voice.muted = true;
 screen.rerender(<GateAskVStatus gatePage={false} pagePath="/work-hub/calendar" />);
 expect(screen.queryByTestId("gate-askv-status")).toBeNull();
 voice.muted = false;
 screen.rerender(<GateAskVStatus gatePage={false} pagePath="/work-hub/calendar" />);
 expect(screen.getByTestId("gate-askv-status")).toBeTruthy();
});
it("stages optional details for a new readback instead of confirming the old draft", async () => {
 const screen = render(<GateAskVStatus />);
 fireEvent.change(screen.getByLabelText("Any other details?"), {target:{value:"Delivering supplies"}});
 fireEvent.click(screen.getByText("Review details"));
 expect(voice.assistant.send).toHaveBeenCalledWith("Update this pending crossing with these additional details: Delivering supplies", "ios_text", undefined, true);
});
it("uses page-neutral wording for a pending action outside Gate", () => {
 const screen = render(<GateAskVStatus gatePage={false} />);
 fireEvent.change(screen.getByLabelText("Any other details?"), {target:{value:"Use the north entrance"}});
 fireEvent.click(screen.getByText("Review details"));
 expect(voice.assistant.send).toHaveBeenCalledWith("Update this pending request with these additional details: Use the north entrance", "ios_text", undefined, true);
 expect(screen.getByTestId("gate-askv-status")).toBeTruthy();
});
it("submits a typed request from the compact panel in focus mode", () => {
 voice.assistant.messages = [];
 const screen = render(<GateAskVStatus gatePage={false} pagePath="/work-hub/calendar" />);
 fireEvent.change(screen.getByLabelText("Ask V on this page"), { target: { value: "Who's on shift?" } });
 fireEvent.click(screen.getByRole("button", { name: "Send to V" }));
 expect(voice.assistant.send).toHaveBeenCalledWith("Who's on shift?", "ios_text", undefined, true);
});

it("opens More on the same page and closes without stopping the voice session", () => {
 const screen = render(<GateAskVStatus />);
 const path = window.location.href;
 fireEvent.click(screen.getByText("More"));
 expect(screen.getByTestId("v-dialogue")).toBeTruthy();
 fireEvent.click(screen.getByText("Conversation back"));
 expect(screen.queryByTestId("v-dialogue")).toBeNull();
 expect(window.location.href).toBe(path);
 expect(voice.setMuted).not.toHaveBeenCalled();
});
