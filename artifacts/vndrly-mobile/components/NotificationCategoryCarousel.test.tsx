import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  scrollTo: vi.fn(),
  layouts: new Map<string, Function>(),
  scrollProps: {} as any,
}));
vi.mock("react-native", async (original) => {
  const actual = await original<typeof import("react-native")>();
  const React = await import("react");
  return {
    ...actual,
    View: ({ onLayout, testID, ...props }: any) => {
      if (onLayout && testID) native.layouts.set(testID, onLayout);
      return <actual.View testID={testID} {...props} />;
    },
    ScrollView: React.forwardRef(({ children, ...props }: any, ref: any) => {
      native.scrollProps = props;
      React.useImperativeHandle(ref, () => ({ scrollTo: native.scrollTo }));
      return <div data-testid={props.testID}>{children}</div>;
    }),
  };
});
vi.mock("@/components/AdaptiveNavigationShell", () => ({
  REGULAR_NAVIGATION_BREAKPOINT: 768,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: any) => <svg>{children}</svg>,
  Defs: ({ children }: any) => <defs>{children}</defs>,
  LinearGradient: ({ children }: any) => (
    <linearGradient>{children}</linearGradient>
  ),
  Rect: () => <rect />,
  Stop: () => <stop />,
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#149F3D", name: "Brand" }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#fff" }) }));
vi.mock("@/components/Pill9Slice", () => ({
  default: ({ source }: any) => <span data-artwork={String(source)} />,
}));
import NotificationCategoryCarousel from "./NotificationCategoryCarousel";

const categories = [
  "all",
  "schedule",
  "gate_crew",
  "messages",
  "handoffs",
  "tasks",
  "compliance",
  "alerts",
];
const labels: Record<string, string> = {
  all: "All",
  schedule: "Schedule",
  gate_crew: "Gate Crew",
  messages: "Messages",
  handoffs: "Handoffs",
  tasks: "Tasks",
  compliance: "Compliance",
  alerts: "Alerts",
};
const props = {
  categories,
  activeCategory: "all",
  unread: {},
  width: 390,
  label: (id: string) => labels[id],
  onSelect: vi.fn(),
};
function layout(id: string, x: number, width: number) {
  act(() =>
    native.layouts.get(id)!({
      nativeEvent: { layout: { x, y: 0, width, height: 44 } },
    }),
  );
}
beforeEach(() => {
  native.scrollTo.mockClear();
  native.layouts.clear();
  props.onSelect.mockClear();
});
afterEach(cleanup);

it("keeps the gate order and labels while selection uses branded artwork and inactive pills use gray artwork", () => {
  render(<NotificationCategoryCarousel {...props} unread={{ messages: 3 }} />);
  expect(screen.getAllByRole("button").map((n) => n.textContent)).toEqual([
    "All",
    "Schedule",
    "Gate Crew",
    "Messages (3)",
    "Handoffs",
    "Tasks",
    "Compliance",
    "Alerts",
  ]);
  expect(
    screen
      .getAllByRole("button")
      .filter((n) => n.getAttribute("aria-selected") === "true"),
  ).toHaveLength(1);
  expect(
    screen
      .getByTestId("notifications-tab-all")
      .querySelector("[data-artwork]")
      ?.getAttribute("data-artwork"),
  ).toContain("pill_green");
  expect(
    screen
      .getByTestId("notifications-tab-schedule")
      .querySelector("[data-artwork]")
      ?.getAttribute("data-artwork"),
  ).toContain("light-grey");
  fireEvent.click(screen.getByTestId("notifications-tab-compliance"));
  expect(props.onSelect).toHaveBeenCalledWith("compliance");
});

it("centers measured selection smoothly, preserves order, and centers both endpoints using end spacers", () => {
  const view = render(<NotificationCategoryCarousel {...props} />);
  layout("notification-category-viewport", 0, 320);
  // Native row coordinates exclude the independent end spacers.
  layout("notification-category-measure-all", 0, 80);
  layout("notification-category-measure-alerts", 770, 100);
  layout("notification-category-measure-compliance", 650, 112);
  expect(
    screen.getByTestId("notification-category-leading-spacer").style.width,
  ).toBe("120px");
  expect(
    screen.getByTestId("notification-category-trailing-spacer").style.width,
  ).toBe("110px");
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true });
  view.rerender(
    <NotificationCategoryCarousel {...props} activeCategory="compliance" />,
  );
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 666, animated: true });
  view.rerender(
    <NotificationCategoryCarousel {...props} activeCategory="alerts" />,
  );
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 780, animated: true });
  native.scrollTo.mockClear();
  act(() => native.scrollProps.onContentSizeChange(1100, 44));
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 780, animated: true });
  native.scrollTo.mockClear();
  fireEvent.click(screen.getByTestId("notifications-tab-alerts"));
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 780, animated: true });
  expect(screen.getAllByRole("button").map((n) => n.textContent)).toEqual(
    Object.values(labels),
  );
  expect(screen.getByTestId("notification-category-fade-left")).toBeTruthy();
  expect(screen.getByTestId("notification-category-fade-right")).toBeTruthy();
  // Larger text or rotation remeasures the endpoint, rather than guessing its width.
  layout("notification-category-measure-alerts", 770, 180);
  expect(
    screen.getByTestId("notification-category-trailing-spacer").style.width,
  ).toBe("70px");
  expect(native.scrollTo).toHaveBeenLastCalledWith({ x: 820, animated: true });
});

it("keeps iPad fixed without recentering or end spacers, enabling overflow only when necessary", () => {
  const view = render(<NotificationCategoryCarousel {...props} width={1024} />);
  layout("notification-category-viewport", 0, 780);
  act(() => native.scrollProps.onContentSizeChange(750, 44));
  layout("notification-category-measure-all", 0, 80);
  layout("notification-category-measure-alerts", 650, 100);
  view.rerender(
    <NotificationCategoryCarousel
      {...props}
      width={1024}
      activeCategory="alerts"
    />,
  );
  expect(native.scrollTo).not.toHaveBeenCalled();
  expect(native.scrollProps.scrollEnabled).toBe(false);
  expect(
    screen.queryByTestId("notification-category-leading-spacer"),
  ).toBeNull();
  expect(screen.queryByTestId("notification-category-fade-left")).toBeNull();
  act(() => native.scrollProps.onContentSizeChange(900, 44));
  expect(native.scrollProps.scrollEnabled).toBe(true);
  expect(screen.getAllByRole("button").map((n) => n.textContent)).toEqual(
    Object.values(labels),
  );
});
