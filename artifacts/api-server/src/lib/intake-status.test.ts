import { describe, expect, it } from "vitest";
import {
  computeInitialLifecycleState,
  computeInitialStatus,
  isOnSiteAtCreate,
} from "./intake-status";

describe("computeInitialLifecycleState", () => {
  it("maps geofence auto-check-in to on_site", () => {
    expect(computeInitialLifecycleState("in_progress", true)).toBe("on_site");
  });

  it("maps office phone intake in_progress to on_site even without GPS", () => {
    expect(computeInitialLifecycleState("in_progress", false)).toBe("on_site");
  });

  it("maps initiated without check-in to pending_arrival", () => {
    expect(computeInitialLifecycleState("initiated", false)).toBe("pending_arrival");
  });

  it("maps awaiting_acceptance to pending_arrival", () => {
    expect(computeInitialLifecycleState("awaiting_acceptance", false)).toBe(
      "pending_arrival",
    );
  });
});

describe("isOnSiteAtCreate", () => {
  it("is true for office_on_behalf_of_field_employee (in_progress, no GPS)", () => {
    const status = computeInitialStatus("office_on_behalf_of_field_employee", false);
    expect(status).toBe("in_progress");
    expect(isOnSiteAtCreate(status, false)).toBe(true);
  });
});
