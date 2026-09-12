import { describe, expect, it } from "vitest";
import { workHubSurfaceForPath } from "./use-work-hub-device-presence";

describe("cross-device active surface projection", () => {
  it.each([
    ["/tickets/42", "ticket", "42"],
    ["/site-locations/7", "site", "7"],
    ["/invoices/19?tab=lines", "invoice", "19"],
    ["/work-hub/meetings/occurrence-one", "meeting", "occurrence-one"],
    ["/work-hub/chat", null, null],
  ])("projects %s without exposing page contents", (path, entityType, entityId) => {
    expect(workHubSurfaceForPath(path, 100)).toEqual({ path, entityType, entityId, updatedAt: 100 });
  });
});
