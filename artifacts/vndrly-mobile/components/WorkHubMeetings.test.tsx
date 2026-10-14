vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "admin" } }) }));
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("./WorkHubConversation", () => ({ default: () => <div>Conversation pane</div> }));
vi.mock("./TogglePillButton", () => ({ default: ({ children, onPress, accessibilityLabel, disabled }: any) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 1100 }),
  Modal: ({ children, visible }: any) => visible ? <div>{children}</div> : null,
  View: ({ children }: any) => <div>{children}</div>, ScrollView: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => <input aria-label={accessibilityLabel} value={value} onChange={e => onChangeText(e.target.value)} />,
}));
vi.mock("./MeetingScheduling", () => ({ default: () => <div>Scheduler fields</div> }));
vi.mock("./WorkHubLiveMeetings",()=>({default:()=> <div>Live meeting list</div>}));
import Meetings from "./WorkHubMeetings";
afterEach(cleanup);
it("opens the scheduler only on request and separates history from upcoming", () => {
  render(<Meetings meetings={[{id:"next",title:"Tomorrow briefing",startsAt:"2099-01-01T12:00:00Z",endsAt:"2099-01-01T13:00:00Z"},{id:"past",title:"Completed briefing",status:"completed"}]} onOpen={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByText("Scheduler fields")).toBeNull();
  expect(screen.queryByText("Completed briefing")).toBeNull();
  fireEvent.click(screen.getByText("History"));
  expect(screen.getByText("Completed briefing")).toBeTruthy();
  fireEvent.click(screen.getByText("Schedule meeting"));
  expect(screen.getByText("Scheduler fields")).toBeTruthy();
  fireEvent.click(screen.getByText("Close scheduler"));
  expect(screen.queryByText("Scheduler fields")).toBeNull();
});
