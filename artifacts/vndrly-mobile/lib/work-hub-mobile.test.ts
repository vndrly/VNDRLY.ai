import { describe, expect, it } from "vitest";
import { mobileOwner, moduleEndpoint } from "./work-hub-mobile";

describe("mobile Work Hub boundary", () => {
  it("keeps mutations in the active organization", () => {
    expect(mobileOwner({ vendorId: 7, partnerId: null })).toEqual({
      type: "vendor",
      id: 7,
    });
    expect(mobileOwner({ vendorId: null, partnerId: 9 })).toEqual({
      type: "partner",
      id: 9,
    });
  });

  it("maps modules to participant-safe read endpoints", () => {
    expect(moduleEndpoint("channels")).toBe("/api/work-hub/channels");
    expect(moduleEndpoint("files-notes")).toBe("/api/work-hub/files");
    expect(moduleEndpoint("tasks-forms")).toBe("/api/work-hub/tasks");
  });
});
