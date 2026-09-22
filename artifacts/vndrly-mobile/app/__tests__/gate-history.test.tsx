import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/GateHistory", () => ({ default: () => <div>native-gate-history</div> }));
import GateHistoryScreen from "../(tabs)/gate-history";

afterEach(cleanup);
it("routes the History tab to the native Gate report screen", () => {
  render(<GateHistoryScreen />);
  expect(screen.getByText("native-gate-history")).toBeTruthy();
});
