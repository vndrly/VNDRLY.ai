import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";

import { cleanup, render, screen } from "@testing-library/react";

// `@expo/vector-icons` pulls in native font assets that jsdom can't
// resolve. Stub Feather to a noop so the pill renders.
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

// Task #56 — these tests cover the externally-visible states the
// active-ticket screen relies on. The pill consumes
// `getLiveLocationStatus` from the reporter, but for a focused render
// test we use the `statusOverride` test seam so we don't have to mock
// the entire native bridge here. The reporter's own status logic is
// covered by `liveLocationReporter.test.ts`.

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

  it("shows the amber 'paused' state with the background-permission hint", () => {
    render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: true,
          flowing: false,
          reasons: ["background_permission_missing"],
          lastPingAt: Date.now(),
        }}
        disableAutoRefresh
      />,
    );
    expect(
      screen.getByTestId("live-location-status-pill-status").textContent,
    ).toBe("paused");
    expect(
      screen.getByTestId("live-location-status-pill-label").textContent,
    ).toBe("Live location: paused");
    expect(
      screen.getByTestId("live-location-status-pill-reason").textContent,
    ).toBe("Tap to allow always-on location");
  });

  it("ranks the foreground-permission reason ahead of stale_pings", () => {
    render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: true,
          flowing: false,
          reasons: ["stale_pings", "foreground_permission_missing"],
          lastPingAt: null,
        }}
        disableAutoRefresh
      />,
    );
    expect(
      screen.getByTestId("live-location-status-pill-reason").textContent,
    ).toBe("Tap to grant location permission");
  });

  it("uses the low-power hint when the OS is throttling", () => {
    render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: true,
          flowing: false,
          reasons: ["low_power_mode"],
          lastPingAt: Date.now(),
        }}
        disableAutoRefresh
      />,
    );
    expect(
      screen.getByTestId("live-location-status-pill-reason").textContent,
    ).toBe("Low Power Mode is throttling updates");
  });

  it("uses the consent-revoked hint when the worker turned off sharing", () => {
    render(
      <LiveLocationStatusPill
        enabled
        statusOverride={{
          hasActiveTicket: true,
          flowing: false,
          reasons: ["consent_missing"],
          lastPingAt: Date.now(),
        }}
        disableAutoRefresh
      />,
    );
    expect(
      screen.getByTestId("live-location-status-pill-reason").textContent,
    ).toBe("Re-enable location sharing in Settings");
  });

  it("uses the stale-pings hint when nothing has landed in a while", () => {
    render(
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
    expect(
      screen.getByTestId("live-location-status-pill-reason").textContent,
    ).toBe("No location update in a while — tap to fix");
  });
});
