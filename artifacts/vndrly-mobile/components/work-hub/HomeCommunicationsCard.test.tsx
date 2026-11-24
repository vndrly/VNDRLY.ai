import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "#00bcd4" }) }));
vi.mock("react-native-svg", () => ({ default: ({ children }: any) => <svg>{children}</svg>, Path: () => null, Rect: () => null }));
vi.mock("@/components/ModalDraft", () => ({ ModalPressable: ({ children, accessibilityLabel, accessibilityState, onPress }: any) => <button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button> }));
vi.mock("./ProviderLogo", () => ({ default: () => <span>Gmail</span> }));

import HomeCommunicationsCard from "./HomeCommunicationsCard";

it("expands communication rows while account rows open directly", () => {
  const openPoll = vi.fn(), openAccount = vi.fn();
  render(<HomeCommunicationsCard title="Communications" subtitle="Stay connected" rows={[
    { key: "polls", label: "Polls", value: "1", items: [{ key: "poll:1", title: "Safety poll", onPress: openPoll }] },
    { key: "emails", label: "Emails", value: "3" },
    { key: "email:gmail", label: "user@example.com", value: "3", provider: "gmail", onPress: openAccount },
  ]} />);
  expect(screen.queryByRole("button", { name: "Communications" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Polls" }));
  fireEvent.click(screen.getByRole("button", { name: "Safety poll" }));
  expect(openPoll).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Emails" }));
  fireEvent.click(screen.getByRole("button", { name: "user@example.com" }));
  expect(openAccount).toHaveBeenCalledOnce();
});
