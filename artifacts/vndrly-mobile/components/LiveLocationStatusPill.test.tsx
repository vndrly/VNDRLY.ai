import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";

import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

import LiveLocationStatusPill from "./LiveLocationStatusPill";
import type { LiveLocationStatus } from "@/lib/liveLocationReporter";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: { en: { translation: en } },
    react: { useSuspense: false },
  });
});

afterEach(() => {
  cleanup();
});

const flowingStatus: LiveLocationStatus = {
  hasActiveTicket: true,
  flowing: true,
  reasons: [],
  lastPingAt: Date.now(),
};

describe("LiveLocationStatusPill (Task #56)", () => {
  it("renders nothing when disabled by the parent", () => {
    const { container } = render(
      <LiveLocationStatusPill
        enabled={false}
        statusOverride={flowingStatus}
        disableAutoRefresh
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there's no active ticket", () => {
    const { container } = render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: false,
          flowing: false,
          reasons: [],
          lastPingAt: null,
        }}
        disableAutoRefresh
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tracking is paused", () => {
    const { container } = render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: true,
          flowing: false,
          reasons: ["stale_pings"],
          lastPingAt: Date.now() - 15 * 60_000,
        }}
        disableAutoRefresh
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the green 'Live location: active' badge when pings are flowing", () => {
    render(
      <LiveLocationStatusPill
        enabled
        statusOverride={flowingStatus}
        disableAutoRefresh
      />,
    );
    expect(
      screen.getByTestId("live-location-status-pill-status").textContent,
    ).toBe("active");
    expect(
      screen.getByTestId("live-location-status-pill-label").textContent,
    ).toBe("Live location: active");
    expect(
      screen.queryByTestId("live-location-status-pill-reason"),
    ).toBeNull();
  });
});
