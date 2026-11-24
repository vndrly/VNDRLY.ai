import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "#00bcd4" }) }));
vi.mock("react-native-svg", () => ({ default: ({ children }: any) => <svg>{children}</svg>, Circle: () => null, Path: () => null, Rect: () => null }));
vi.mock("@/components/ModalDraft", () => ({
  ModalPressable: ({ children, accessibilityLabel, accessibilityState, onPress }: any) =>
    <button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button>,
}));

import HomeTodayCard from "./HomeTodayCard";

it("keeps the card open and expands calendar items within its row", () => {
  const onPress = vi.fn(), onViewAll = vi.fn();
  render(<HomeTodayCard title="Today" subtitle="Your work" rows={[{ key: "calendar", label: "Calendar", value: "2", items: [{ key: "shift:1", title: "North gate shift", onPress }], empty: "No calendar items", onViewAll }]} />);
  expect(screen.getByRole("button", { name: "Calendar" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  expect(screen.getByRole("button", { name: "Calendar" }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "North gate shift" }));
  expect(onPress).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "View all Calendar" }));
  expect(onViewAll).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  expect(screen.queryByRole("button", { name: "North gate shift" })).toBeNull();
});
