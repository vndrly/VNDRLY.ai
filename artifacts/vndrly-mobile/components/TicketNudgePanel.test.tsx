import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#111",
    foreground: "#fff",
    card: "#222",
    border: "#333",
    primary: "#f59e0b",
    mutedForeground: "#999",
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#f59e0b" }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => []),
}));

const tIdentity = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    cb();
  },
}));

import TicketNudgePanel from "./TicketNudgePanel";

afterEach(() => {
  cleanup();
});

describe("TicketNudgePanel", () => {
  it("always renders both nudge up and nudge down buttons for field employees", () => {
    render(
      <TicketNudgePanel
        ticketId={101}
        ticketStatus="in_progress"
        userRole="field_employee"
      />,
    );

    expect(screen.getByTestId("button-nudge-up")).toBeTruthy();
    expect(screen.getByTestId("button-nudge-down")).toBeTruthy();
  });
});
