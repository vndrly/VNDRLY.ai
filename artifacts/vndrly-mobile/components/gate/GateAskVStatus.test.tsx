import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateAskVStatus from "./GateAskVStatus";
import { registerGateVoiceForm } from "@workspace/gate-booth";
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
  setMuted: vi.fn(), paused: false, setPaused: vi.fn(), assistant: { streaming: false, send: vi.fn(), messages: [
    { role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" },
  ] } }));
vi.mock("@/hooks/use-askv-voice-session", () => ({ useAskVVoiceSession: () => voice }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8" }) }));
vi.mock("./GateChrome", () => ({ useGateCopy: () => (en: string) => en }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("shows checkout details in the pane and routes confirmation to checkout", () => {
 const unregister=registerGateVoiceForm({read:()=>({checkoutReview:{firstName:"John",lastName:"Smith",company:"John's Trucking",plateState:"OK",vehiclePlate:"ABC123"}}),saved:()=>{}});
 try {
  const view=render(<GateAskVStatus/>);
  expect(view.getByText("Check out:")).toBeTruthy();
  expect(view.getByText("John Smith")).toBeTruthy();
  expect(view.getByText("John's Trucking")).toBeTruthy();
  expect(view.getByText("OK ABC123")).toBeTruthy();
  fireEvent.click(view.getByText("Confirm?"));
  expect(voice.assistant.send).toHaveBeenCalledWith("Confirm","ios_text","server-confirmation",true);
  expect(voice.confirmCheckIn).not.toHaveBeenCalled();
 }finally{cleanup();unregister();}
});
beforeEach(() => { vi.clearAllMocks(); voice.checkInReview = null; voice.shiftNoteDraft = null; voice.muted = false; voice.paused = false; voice.checkInSaving = false; voice.checkInError = null; voice.state = "listening"; voice.assistant.streaming = false; voice.assistant.messages = [{ role: "assistant", content: "Review this crossing", pending: false, confirmationReference: "server-confirmation" }]; });
it("renders tables and tool-backed comparisons inside the top pane", () => {
 voice.assistant.messages = [{role:"assistant",content:"| Site | Visits |\n| --- | --- |\n| North | 12 |",pending:false,toolCalls:["last_year","ytd"].map((preset,index)=>({name:"query_revenue_summary",input:{preset,breakdown:"site"},output:JSON.stringify({role:"vendor",preset,breakdown:"site",periodLabel:index?"2026 YTD":"2025",rows:[{siteName:"North",amount:index?"20":"10"}]})}))}] as any;
 const view=render(<GateAskVStatus gatePage={false}/>);
 expect(view.getByText("Visits")).toBeTruthy();
 expect(view.getByTestId("askv-revenue-comparison")).toBeTruthy();
});
it("hides an unfinished check-in when disengaged and preserves the review", () => {
 voice.checkInReview={key:"review",firstName:"Jo",lastName:"Perez",company:"Example",vehiclePlate:"ABC123",plateState:"OK",destinationName:"",destinationNeedsReview:false,details:[],ready:true,missing:[]};
 const view=render(<GateAskVStatus/>);
 expect(view.queryByLabelText("Gate details or correction")).toBeNull();
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
  voice.checkInReview = { key: "review", firstName: "John", lastName: "Elleryk", company: "John's Trucking", vehiclePlate: "ABC123", plateState: "OK", destinationName: "Wildcat 2", destinationNeedsReview: false, details: ["Red truck"], ready: true, missing: [] };
  const screen = render(<GateAskVStatus />);
  expect(screen.getByTestId("gate-askv-check-in").textContent).toBe("Check in:John EllerykJohn's TruckingOK ABC123Confirm?Pause");
  fireEvent.click(screen.getByRole("button", { name: "Confirm?" }));
  expect(voice.confirmCheckIn).toHaveBeenCalledExactlyOnceWith("review");
  expect(voice.assistant.send).not.toHaveBeenCalled();
});

it("says what Confirm is waiting for, that it is saving, and why a save failed", () => {
  voice.checkInReview = { key: "review", firstName: "John", lastName: "Smith", company: "", vehiclePlate: "", plateState: "", destinationName: "", destinationNeedsReview: false, details: [], ready: false, missing: ["company", "vehiclePlate", "plateState"] };
  const screen = render(<GateAskVStatus />);
  expect(screen.getByTestId("gate-askv-check-in-status").textContent).toBe("Still needed: company, tag, state.");
  voice.checkInReview = { ...voice.checkInReview, company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX", ready: true, missing: [] };
  screen.rerender(<GateAskVStatus />);
  expect(screen.queryByTestId("gate-askv-check-in-status")).toBeNull();
  voice.checkInSaving = true; screen.rerender(<GateAskVStatus />);
  expect(screen.getByTestId("gate-askv-check-in-status").textContent).toBe("Saving…");
  voice.checkInSaving = false; voice.checkInError = "This vehicle already has an active visit." as any; screen.rerender(<GateAskVStatus />);
  expect(screen.getByTestId("gate-askv-check-in-status").textContent).toBe("Not saved: This vehicle already has an active visit.");
});

it("names the operator's watch gate when the entry is made away from the Gate page", () => {
  const unregister = registerGateVoiceForm({ read: () => ({ watchForm: true, gateStationName: "Outer Circle" }), saved: () => {} });
  try {
    voice.checkInReview = { key: "review", firstName: "John", lastName: "Smith", company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX", destinationName: "", destinationNeedsReview: false, details: [], ready: true, missing: [] };
    const screen = render(<GateAskVStatus gatePage={false} />);
    expect(screen.getByText("Check in at Outer Circle:")).toBeTruthy();
  } finally { unregister(); }
});

it("pauses and resumes V from the check-in card, and keeps a paused check-in on screen before anything is filled", () => {
  voice.checkInReview = { key: "review", firstName: "John", lastName: "", company: "", vehiclePlate: "", plateState: "", destinationName: "", destinationNeedsReview: false, details: [], ready: false, missing: ["lastName", "company", "vehiclePlate", "plateState"] };
  const screen = render(<GateAskVStatus />);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(voice.setPaused).toHaveBeenCalledExactlyOnceWith(true);
  voice.paused = true; voice.checkInReview = { ...voice.checkInReview!, firstName: "" };
  screen.rerender(<GateAskVStatus />);
  expect(screen.getByText("V is paused. Say “Hey V” or tap Resume.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(voice.setPaused).toHaveBeenLastCalledWith(false);
  expect(voice.setMuted).not.toHaveBeenCalled();
});

it("offers Pause beside Stop V, and Resume once V is paused", () => {
  voice.assistant.messages = [];
  const screen = render(<GateAskVStatus gatePage={false} />);
  expect(screen.getByText("V is listening.")).toBeTruthy();
  fireEvent.click(screen.getByText("Pause"));
  expect(voice.setPaused).toHaveBeenCalledExactlyOnceWith(true);
  voice.paused = true;
  screen.rerender(<GateAskVStatus gatePage={false} />);
  expect(screen.getByText("V is paused.")).toBeTruthy();
  expect(screen.queryByText("Pause")).toBeNull();
  fireEvent.click(screen.getByText("Resume"));
  expect(voice.setPaused).toHaveBeenLastCalledWith(false);
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

it.each(["connecting", "listening", "thinking"])("keeps %s and Stop V in one compact row", state => {
  voice.muted = false;
  voice.state = state;
  voice.assistant.messages = [];
  const screen = render(<GateAskVStatus />);
  const row = screen.getByTestId("gate-askv-status");
  expect(row.style.flexDirection).toBe("row");
  expect(screen.getByText(state === "connecting" ? "Connecting to V…" : state === "thinking" ? "V is thinking…" : "V is listening.")).toBeTruthy();
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
