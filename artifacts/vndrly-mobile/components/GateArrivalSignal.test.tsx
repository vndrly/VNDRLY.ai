import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AccessibilityInfo, Animated } from "react-native";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import GateArrivalSignal from "./GateArrivalSignal";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps the arriving label still when reduced motion is enabled", async () => {
 vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
 const animate = vi.spyOn(Animated, "loop");
 render(<GateArrivalSignal fresh />);
 expect(screen.getByText("gatekeeper.arriving")).toBeTruthy();
 await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
 expect(animate).not.toHaveBeenCalled();
});
it("pulses a new leg once and does not restart for an ordinary rerender", async () => {
 vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
 const start = vi.fn(), stop = vi.fn();
 const animate = vi.spyOn(Animated, "loop").mockReturnValue({ start, stop, reset: vi.fn() } as any);
 const view = render(<GateArrivalSignal fresh />);
 await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
 view.rerender(<GateArrivalSignal fresh />);
 expect(animate).toHaveBeenCalledTimes(1);
 view.rerender(<GateArrivalSignal fresh={false} />);
 expect(stop).toHaveBeenCalledTimes(1);
});
