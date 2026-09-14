import { describe, expect, it } from "vitest";
import { createActiveShiftTracking } from "../../lib/active-shift-tracking";
import {
  createImplementationAQueue,
  type ImplementationAScope,
} from "../../lib/implementation-a-queue";
import { mobileWorkHubModules } from "../../lib/work-hub-mobile";

describe("Implementation A mobile journey", () => {
  it("keeps the field day visible, offline-capable, and permission scoped", async () => {
    const phoneModules = mobileWorkHubModules(false, false).map(
      (module) => module.key,
    );
    expect(phoneModules).toEqual(
      expect.arrayContaining([
        "managed-crews",
        "workforce-coverage",
        "inventory",
        "site-presence",
        "safety-response",
        "calls",
        "meetings",
        "askv",
      ]),
    );
    expect(phoneModules).not.toContain("operations-health");
    expect(
      mobileWorkHubModules(true, true).map((module) => module.key),
    ).toEqual(expect.arrayContaining(["operations-health", "crews"]));

    const tracking = createActiveShiftTracking({
      consentVersion: 2,
      requiredConsentVersion: 2,
    });
    expect(tracking.openApp()).toMatchObject({
      state: "off_duty",
      sharing: false,
    });
    expect(
      tracking.shiftStarted({ shiftId: "shift-a", approved: true }),
    ).toMatchObject({
      state: "tracking",
      sharing: true,
      indicator: "Work location sharing on",
    });
    expect(
      tracking.health({ batteryPercent: 12, locationAgeMs: 180_000 }),
    ).toMatchObject({
      battery: "low",
      location: "stale",
    });

    let serialized: string | null = null;
    const queue = createImplementationAQueue({
      getItem: async () => serialized,
      setItem: async (_key, value) => {
        serialized = value;
      },
    });
    const scope: ImplementationAScope = {
      userId: 41,
      ownerOrgType: "vendor",
      ownerOrgId: 7,
      deviceId: "field-device-a",
    };
    await queue.enqueue(scope, {
      operationId: "8cfc515c-f9e3-4f1d-834b-c59c831ee311",
      domain: "custody",
      domainVersion: 1,
      path: "/api/implementation-a/assets/asset-a/checkout",
      method: "POST",
      payload: {
        identifier: { kind: "plate", jurisdiction: "TX", value: "ABC123" },
      },
      originalEventAt: "2026-09-14T12:00:00.000Z",
    });
    await queue.enqueue(scope, {
      operationId: "8cfc515c-f9e3-4f1d-834b-c59c831ee312",
      domain: "incident",
      domainVersion: 1,
      path: "/api/implementation-a/safety/incidents",
      method: "POST",
      payload: { severity: "high", source: "manual" },
      originalEventAt: "2026-09-14T12:01:00.000Z",
    });
    const delivered: string[] = [];
    const flushed = await queue.flush(scope, async (item) => {
      delivered.push(item.domain);
      if (item.domain === "custody")
        throw Object.assign(new Error("conflict"), { status: 409 });
    });
    expect(delivered).toEqual(["custody", "incident"]);
    expect(flushed.items).toHaveLength(1);
    expect(flushed.items[0]).toMatchObject({
      domain: "custody",
      state: "conflict",
      visibleResolution: "Review the latest custody history before retrying.",
    });
    expect(tracking.shiftEnded()).toMatchObject({
      state: "off_duty",
      sharing: false,
    });
  });
});
