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
import Inbox from "./WorkHubChatInbox";
afterEach(cleanup);
it("keeps the directory out of the inbox and searches recipients only in New chat", () => {
  const onTarget = vi.fn();
  render(<Inbox channels={[{ id: "c", name: "Gate team" }]} groups={[]} people={[{ id: 1, displayName: "Riley", organizationName: "Demo" }, { id: 2, displayName: "Rowan" }]} selected={null} onSelect={vi.fn()} onTarget={onTarget} onStart={vi.fn()} target="" busy={false} notice="" />);
  expect(screen.queryByText("Riley")).toBeNull();
  fireEvent.click(screen.getByLabelText("New chat"));
  fireEvent.change(screen.getByLabelText("Search chat recipients"), { target: { value: "Demo" } });
  expect(screen.getByText("Riley")).toBeTruthy();
  expect(screen.queryByText("Rowan")).toBeNull();
  fireEvent.click(screen.getByLabelText("Select Riley"));
  expect(onTarget).toHaveBeenLastCalledWith("person", "1");
});
