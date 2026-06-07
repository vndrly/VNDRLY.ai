import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "#fff",
    card: "#222",
    border: "#333",
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#f59e0b" }),
}));

const tIdentity = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

import ForemanQuickActions from "./ForemanQuickActions";

afterEach(() => {
  cleanup();
});

describe("ForemanQuickActions", () => {
  it("renders quick action tiles in the foreman portal layout order", () => {
    render(<ForemanQuickActions unreadAlerts={3} pendingSchedule={1} />);

    const ids = [
      "foreman-action-alerts",
      "foreman-action-start-job",
      "foreman-action-schedule",
      "foreman-action-comms",
    ].map((id) => screen.getByTestId(id).getAttribute("data-testid"));

    expect(ids).toEqual([
      "foreman-action-alerts",
      "foreman-action-start-job",
      "foreman-action-schedule",
      "foreman-action-comms",
    ]);
  });
});
