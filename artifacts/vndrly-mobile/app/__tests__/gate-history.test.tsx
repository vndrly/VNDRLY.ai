import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/GateWebPage", () => ({ default: ({ path }: { path: string }) => <div>{path}</div> }));
import GateHistoryScreen from "../(tabs)/gate-history";

afterEach(cleanup);
it("routes the History tab to the embedded Gate report screen", () => {
  render(<GateHistoryScreen />);
  expect(screen.getByText("/gate/history")).toBeTruthy();
});
