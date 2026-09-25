import { describe, expect, it } from "vitest";
import { mobileOwner, mobileWorkHubModules, moduleEndpoint } from "./work-hub-mobile";

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
    expect(moduleEndpoint("channels")).toBe("/api/work-hub/crews");
    expect(moduleEndpoint("files-notes")).toBe("/api/work-hub/files");
    expect(moduleEndpoint("tasks-forms")).toBe("/api/work-hub/tasks");
    expect(moduleEndpoint("operations-health")).toBe("/api/implementation-a/operations-health");
  });

  it("labels Groups and the active company Chat consistently", () => {
    const items = mobileWorkHubModules(false, false, "MidCon Solutions");
    expect(items.find((item) => item.key === "channels")?.label).toBe("Groups");
    expect(items.find((item) => item.key === "chat")?.label).toBe("MidCon Solutions Chat");
  });

  it("shows Exports only for a role with an allowed dataset", () => {
    const gatekeeper = mobileWorkHubModules(false, false, "MidCon", {
      canViewExports: false,
      allowedExportDatasets: [],
    });
    const supervisor = mobileWorkHubModules(false, false, "MidCon", {
      canViewExports: true,
      allowedExportDatasets: ["staffing"],
    });
    expect(gatekeeper.some((item) => item.key === "implementation-exports")).toBe(false);
    expect(supervisor.some((item) => item.key === "implementation-exports")).toBe(true);
    expect(gatekeeper.some((item) => item.key === "files-notes")).toBe(true);
  });
});
