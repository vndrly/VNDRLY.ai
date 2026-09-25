import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Assets } from "./Assets";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));

it("shows custody location from the canonical asset summary", () => {
  render(<Assets assets={[{ id: "a1", name: "Radio", category: "equipment", status: "checked_out", currentLocation: "user:7", condition: "good", holderUserId: 7 }]} />);
  expect(screen.getByText(/user:7/)).toBeTruthy();
});
