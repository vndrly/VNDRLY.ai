import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    },
    api: vi.fn(async () => ({})),
    upload: vi.fn(async () => ({ status: 200 })),
    remove: vi.fn(async () => undefined),
    token: vi.fn(async () => "token"),
  };
});

vi.mock("./work-hub-queue-native", () => ({ getNativeWorkHubQueueStore: async () => env.store }));
vi.mock("./api", () => ({ apiFetch: env.api, getApiBase: () => "https://vndrly.example" }));
vi.mock("./auth", () => ({ getToken: env.token }));
vi.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: env.upload,
  deleteAsync: env.remove,
}));

import { flushNativeWorkHubQueue, queueNativeWorkHubRequest, workHubQueueScope } from "./work-hub-queue-runtime";

const user = {
  id: 7,
  username: "susie",
  role: "vendor",
  displayName: "Susie",
  activeMembershipId: 31,
  availableMemberships: [{ id: 31, orgType: "vendor" as const, orgId: 11, orgName: "MidCon", orgLogoUrl: null, role: "admin", vendorPeopleId: null }],
};

describe("native Work Hub queue runtime", () => {
  beforeEach(() => { env.values.clear(); vi.clearAllMocks(); });

  it("derives the queue scope from the active membership, not an arbitrary organization", () => {
    expect(workHubQueueScope(user)).toEqual({ userId: 7, ownerOrgType: "vendor", ownerOrgId: 11 });
  });

  it("queues an exact request body and later sends it with the stable operation ID", async () => {
    const body = { operationId: "11111111-1111-4111-8111-111111111111", payload: { title: "Inspect" } };
    await queueNativeWorkHubRequest(user, "/api/work-hub/tasks", "POST", body);
    await flushNativeWorkHubQueue(user);
    expect(env.api).toHaveBeenCalledWith("/api/work-hub/tasks", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-operation-id": body.operationId },
    });
  });

  it("flushes queued files through the authenticated binary upload path", async () => {
    const { queueNativeWorkHubUpload } = await import("./work-hub-queue-runtime");
    await queueNativeWorkHubUpload(user, "/api/work-hub/files", "file:///private/photo.jpg", "image/jpeg", [], { "x-file-name": "photo.jpg" }, true);
    await flushNativeWorkHubQueue(user);
    expect(env.upload).toHaveBeenCalledWith(
      "https://vndrly.example/api/work-hub/files",
      "file:///private/photo.jpg",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token", "Content-Type": "image/jpeg", "x-file-name": "photo.jpg" }) }),
    );
    expect(env.remove).toHaveBeenCalledWith("file:///private/photo.jpg", { idempotent: true });
  });
});
