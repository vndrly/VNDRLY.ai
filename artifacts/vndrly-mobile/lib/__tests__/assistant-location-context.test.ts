import { describe, expect, it } from "vitest";

import {
  buildAskVLocationContext,
  readAskVCurrentLocationForMessage,
  shouldAttachAskVLocation,
  type AskVLocationProvider,
} from "../assistant-location-context";

describe("shouldAttachAskVLocation", () => {
  it("attaches location for ticket and map routing questions", () => {
    expect(shouldAttachAskVLocation("How many miles to my next ticket?")).toBe(true);
    expect(shouldAttachAskVLocation("How long will it take to get to ticket #10959?")).toBe(true);
    expect(shouldAttachAskVLocation("What jobs are near me on the map?")).toBe(true);
  });

  it("does not wait for GPS for ordinary Gate, map, ticket or site actions", () => {
    for (const message of ["Open the gate map", "Check in Casey Reed", "Fill the visitor check-in form", "Read my site notes", "Show ticket 10959"]) {
      expect(shouldAttachAskVLocation(message)).toBe(false);
    }
  });

  it("does not attach location for unrelated AskV questions", () => {
    expect(shouldAttachAskVLocation("How many open invoices do we have?")).toBe(false);
    expect(shouldAttachAskVLocation("Summarize my notifications")).toBe(false);
  });
});

describe("buildAskVLocationContext", () => {
  it("normalizes expo-location coordinates for request-scoped AskV use", () => {
    expect(
      buildAskVLocationContext({
        coords: {
          latitude: 31.9972,
          longitude: -102.0779,
          accuracy: 14.7,
        },
        timestamp: 1_788_345_600_000,
      }),
    ).toEqual({
      latitude: 31.9972,
      longitude: -102.0779,
      accuracyMeters: 14.7,
      capturedAt: "2026-09-02T10:40:00.000Z",
      source: "mobile_device",
    });
  });
});

describe("readAskVCurrentLocationForMessage", () => {
  function provider(overrides: Partial<AskVLocationProvider> = {}) {
    const defaults: AskVLocationProvider = {
      getForegroundPermissionsAsync: async () => ({ status: "undetermined" }),
      requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
      getCurrentPositionAsync: async () => ({
        coords: { latitude: 32.002, longitude: -102.101, accuracy: 18 },
        timestamp: 1_788_345_600_000,
      }),
    };
    return {
      ...defaults,
      ...overrides,
    };
  }

  it("requests foreground permission when a map question needs live GPS", async () => {
    let requested = false;
    const loc = await readAskVCurrentLocationForMessage(
      "What is my ETA to ticket #10959?",
      provider({
        requestForegroundPermissionsAsync: async () => {
          requested = true;
          return { status: "granted" };
        },
      }),
      "balanced",
    );

    expect(requested).toBe(true);
    expect(loc).toMatchObject({
      latitude: 32.002,
      longitude: -102.101,
      source: "mobile_device",
    });
  });

  it("does not request GPS for non-location AskV questions", async () => {
    let requested = false;
    const loc = await readAskVCurrentLocationForMessage(
      "Summarize my notifications",
      provider({
        requestForegroundPermissionsAsync: async () => {
          requested = true;
          return { status: "granted" };
        },
      }),
      "balanced",
    );

    expect(loc).toBeNull();
    expect(requested).toBe(false);
  });

  it("returns null when foreground location is denied", async () => {
    const loc = await readAskVCurrentLocationForMessage(
      "How far am I from the site?",
      provider({
        requestForegroundPermissionsAsync: async () => ({ status: "denied" }),
      }),
      "balanced",
    );

    expect(loc).toBeNull();
  });
});
