import { describe, expect, it } from "vitest";
import { loadFilesInventoryData, mobileOwner, mobileWorkHubModules, moduleEndpoint } from "./work-hub-mobile";

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

describe("combined files and inventory loading", () => {
  it("loads notes from more than fifty authorized channels", async () => {
    const channels = Array.from({ length: 101 }, (_, index) => ({ id: `channel-${index}`, name: `Group ${index}`, updatedAt: new Date(Date.UTC(2026, 8, 24, 12, 0, 0) - index * 1000).toISOString() }));
    const requests: string[] = [];
    const fetchJson = async (path: string): Promise<any> => {
      requests.push(path);
      if (path.startsWith("/api/work-hub/channels?")) {
        const parsed = new URL(path, "https://example.test");
        const before = parsed.searchParams.get("before");
        const beforeId = parsed.searchParams.get("beforeId");
        return channels.filter(channel => !before || channel.updatedAt < before || (channel.updatedAt === before && channel.id < beforeId!)).slice(0, 100);
      }
      if (path.endsWith("/notes")) return [{ id: `note-${path.split("/")[4]}` }];
      if (path === "/api/implementation-a/assets") return { assets: [] };
      if (path === "/api/work-hub/home") return { capabilities: { canCreateNote: true } };
      if (path.startsWith("/api/work-hub/file-library?")) return [];
      throw new Error(`Unexpected request ${path}`);
    };
    const result = await loadFilesInventoryData({ type: "vendor", id: 7 }, fetchJson);
    expect(result.channels).toHaveLength(101);
    expect(result.notes).toHaveLength(101);
    expect(requests.filter(path => path.startsWith("/api/work-hub/channels?"))).toHaveLength(2);
  });
});
