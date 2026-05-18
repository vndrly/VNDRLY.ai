import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";

import { cleanup, render, screen } from "@testing-library/react";

import FreshnessPill from "./FreshnessPill";

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

describe("FreshnessPill (Task #678)", () => {
  it("shows 'Connecting…' on the very first load when no prior data exists", () => {
    render(
      <FreshnessPill
        lastLoadedAt={null}
        inFlight={true}
        errored={false}
        rateLimited={false}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "connecting",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Connecting…",
    );
  });

  it("shows 'Live' immediately after a successful fetch (within fresh window)", () => {
    render(
      <FreshnessPill
        lastLoadedAt={Date.now()}
        inFlight={false}
        errored={false}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "live",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe("Live");
  });

  it("shows 'Updated Xm ago' once the data ages past the fresh window", () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    render(
      <FreshnessPill
        lastLoadedAt={fiveMinutesAgo}
        inFlight={false}
        errored={false}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "stale",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Updated 5m ago",
    );
  });

  it("flips to 'Reconnecting…' while a refresh is in flight after an error", () => {
    render(
      <FreshnessPill
        lastLoadedAt={Date.now() - 2 * 60 * 1000}
        inFlight={true}
        errored={true}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "reconnecting",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Reconnecting…",
    );
  });

  it("flips to 'Reconnecting…' while parked by the rate-limit gate", () => {
    render(
      <FreshnessPill
        lastLoadedAt={Date.now()}
        inFlight={false}
        errored={false}
        rateLimited={true}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "reconnecting",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Reconnecting…",
    );
  });

  it("shows the prior 'Updated Xm ago' age when an error happens but a previous load exists", () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    render(
      <FreshnessPill
        lastLoadedAt={tenMinutesAgo}
        inFlight={false}
        errored={true}
      />,
    );
    expect(screen.getByTestId("freshness-pill-status").textContent).toBe(
      "stale",
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Updated 10m ago",
    );
  });

  it("formats hours and days for very stale data", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const { rerender } = render(
      <FreshnessPill
        lastLoadedAt={twoHoursAgo}
        inFlight={false}
        errored={false}
      />,
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Updated 2h ago",
    );

    rerender(
      <FreshnessPill
        lastLoadedAt={Date.now() - 3 * 24 * 60 * 60 * 1000}
        inFlight={false}
        errored={false}
      />,
    );
    expect(screen.getByTestId("freshness-pill-label").textContent).toBe(
      "Updated 3d ago",
    );
  });
});
