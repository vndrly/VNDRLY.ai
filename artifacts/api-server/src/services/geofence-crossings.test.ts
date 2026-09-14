import { describe, expect, it } from "vitest";
import { evaluateDirectionalCrossing } from "./geofence-crossings";

const at = (seconds: number) => new Date(1_800_000_000_000 + seconds * 1_000);

describe("directional geofence crossings", () => {
  it("rejects GPS drift around the boundary", () => {
    expect(evaluateDirectionalCrossing([
      { at: at(0), distanceMeters: 105, accuracyMeters: 30 },
      { at: at(4), distanceMeters: 95, accuracyMeters: 30 },
      { at: at(8), distanceMeters: 108, accuracyMeters: 30 },
      { at: at(12), distanceMeters: 92, accuracyMeters: 30 },
    ], { radiusMeters: 100, presenceMs: 8_000 })).toEqual({ kind: "none" });
  });

  it("rejects drive-bys without brief inside presence", () => {
    expect(evaluateDirectionalCrossing([
      { at: at(0), distanceMeters: 160, accuracyMeters: 5 },
      { at: at(5), distanceMeters: 80, accuracyMeters: 5 },
      { at: at(9), distanceMeters: 150, accuracyMeters: 5 },
    ], { radiusMeters: 100, presenceMs: 8_000 })).toEqual({ kind: "none" });
  });

  it("preserves the original boundary crossing time after presence confirmation", () => {
    const samples = [
      { at: at(0), distanceMeters: 150, accuracyMeters: 5 },
      { at: at(5), distanceMeters: 130, accuracyMeters: 5 },
      { at: at(10), distanceMeters: 80, accuracyMeters: 5 },
      { at: at(20), distanceMeters: 70, accuracyMeters: 5 },
    ];
    expect(evaluateDirectionalCrossing(samples, { radiusMeters: 100, presenceMs: 8_000 })).toMatchObject({ kind: "entry", crossedAt: samples[2].at });
  });
});
