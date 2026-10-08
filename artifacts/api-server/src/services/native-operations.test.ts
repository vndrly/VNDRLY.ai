import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SessionPayload } from "../lib/session";
import {
  initialNativeState,
  type NativeRequest,
  type NativeState,
} from "./native-operations-policy";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  fanout: vi.fn(),
  photo: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({ query: mocks.query, release: mocks.release }),
  },
}));
vi.mock("./ticket-photo-association", () => ({
  ownedTicketPhoto: mocks.photo,
}));
vi.mock("../work-hub/events", () => ({
  fanOutPersistedWorkHubEvent: mocks.fanout,
}));
vi.mock("../lib/objectStore", () => ({
  getObjectStore: () => ({
    getUploadDescriptor: () => ({
      objectPath: "/objects/uploads/44444444-4444-4444-8444-444444444444",
      uploadURL:
        "/api/storage/upload/44444444-4444-4444-8444-444444444444?signature=first",
    }),
  }),
  renewObjectUploadDescriptor: (objectPath: string) => ({
    objectPath,
    uploadURL:
      "/api/storage/upload/44444444-4444-4444-8444-444444444444?signature=renewed",
  }),
}));
vi.mock("../routes/notifications", () => ({ fanOutPushToUser: vi.fn() }));
import {
  nativeOperationsService,
  authorizeNativeAutomaticArrival,
  withNativeLocationCollection,
} from "./native-operations";
const phone = "11111111-1111-4111-8111-111111111111",
  nextPhone = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const admin: SessionPayload = {
  userId: 10,
  vendorId: 1,
  role: "vendor",
  sv: 1,
};
const worker: SessionPayload = {
  userId: 20,
  vendorId: 1,
  role: "field_employee",
  sv: 1,
};
const partner: SessionPayload = {
  userId: 30,
  partnerId: 2,
  role: "partner",
  sv: 1,
};
let native: NativeState,
  history: NativeRequest[],
  grants: any[],
  memberships: boolean,
  suspended: boolean,
  companyEnabled: boolean,
  requesterEnabled: boolean;
const input = () => ({
  workerUserId: 20,
  vendorId: 1,
  kind: "location" as const,
  purpose: "Confirm safe arrival",
  idempotencyKey: key,
});
beforeEach(() => {
  vi.clearAllMocks();
  native = initialNativeState();
  history = [];
  grants = [];
  memberships = true;
  suspended = false;
  companyEnabled = true;
  requesterEnabled = true;
  mocks.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.includes("SELECT session_version,suspended_at"))
      return {
        rows: [
          {
            session_version: 1,
            suspended_at: suspended ? new Date() : null,
            must_change_password: false,
          },
        ],
      };
    if (sql.includes("SELECT session_version FROM users"))
      return { rows: [{ session_version: 1 }] };
    if (sql.includes("SELECT role FROM user_org_memberships"))
      return {
        rows: memberships
          ? [{ role: [10, 30].includes(args[0]) ? "admin" : "field_employee" }]
          : [],
      };
    if (sql.includes("SELECT native_operations_policy"))
      return {
        rows: [
          {
            native_operations_policy: {
              enabled: sql.includes("partners")
                ? requesterEnabled
                : companyEnabled,
              grants,
            },
          },
        ],
      };
    if (sql.includes("SELECT m.id FROM user_org_memberships"))
      return { rows: [{ id: 1 }] };
    if (sql.includes("SELECT native_operations FROM"))
      return { rows: [{ native_operations: native }] };
    if (sql.includes("INSERT INTO work_hub_device_preferences")) {
      native = JSON.parse(args[2]);
      return { rows: [] };
    }
    if (sql.includes("SELECT DISTINCT ON"))
      return { rows: history.map((request) => ({ request })) };
    if (sql.includes("SELECT payload->'request' AS request"))
      return {
        rows: history
          .filter((r) => r.id === args[0])
          .map((request) => ({ request })),
      };
    if (sql.includes("INSERT INTO work_hub_user_events")) {
      const payload = JSON.parse(args[3]);
      if (payload.request) {
        history = history.filter((r) => r.id !== payload.request.id);
        history.push(payload.request);
      }
      return { rows: [{ sequence: 1, created_at: new Date() }] };
    }
    if (sql.includes("SELECT t.id,t.site_location_id"))
      return { rows: [{ id: 7, site_location_id: 3 }] };
    if (sql.includes("SELECT id FROM site_locations"))
      return { rows: [{ id: 3 }] };
    if (sql.includes("SELECT id FROM work_hub_devices"))
      return { rows: [{ id: args[0] }] };
    if (sql.includes("SELECT 1 FROM work_hub_devices")) return { rows: [] };
    return { rows: [] };
  });
});
describe("native operations durable boundary", () => {
  it("rechecks current membership and session version before every write", async () => {
    memberships = false;
    await expect(
      nativeOperationsService.request(admin, input()),
    ).rejects.toThrow("native.membership_required");
    expect(history).toHaveLength(0);
    memberships = true;
    suspended = true;
    await expect(
      nativeOperationsService.request(admin, input()),
    ).rejects.toThrow("native.current_session_required");
  });
  it("denies worker and ungranted partner supervisor request creation", async () => {
    await expect(
      nativeOperationsService.request(worker, input()),
    ).rejects.toThrow("native.no_access");
    await expect(
      nativeOperationsService.request(partner, {
        ...input(),
        siteId: 3,
        ticketId: 7,
      }),
    ).rejects.toThrow("native.no_access");
    expect(history).toHaveLength(0);
  });
  it("permits explicit worker-company granted partner on exact worker/site/ticket only", async () => {
    grants = [
      { requesterUserId: 30, workerUserId: 20, siteId: 3, ticketId: 7 },
    ];
    const r = await nativeOperationsService.request(partner, {
      ...input(),
      siteId: 3,
      ticketId: 7,
    });
    expect(r.state).toBe("unavailable");
    await expect(
      nativeOperationsService.request(partner, {
        ...input(),
        siteId: 4,
        ticketId: 7,
      }),
    ).rejects.toThrow("native.no_access");
    expect(history).toHaveLength(1);
  });
  it("records unavailable immediately off duty and retains timestamped last known explicitly", async () => {
    native.lastLocation = {
      latitude: 1,
      longitude: 2,
      accuracy: 3,
      capturedAt: "2026-01-01T00:00:00Z",
    };
    const r = await nativeOperationsService.request(admin, input());
    expect(r.state).toBe("unavailable");
    expect(r.result).toMatchObject({
      reason: "off_duty",
      lastKnown: native.lastLocation,
    });
    expect(
      mocks.query.mock.calls.findIndex((c) =>
        String(c[0]).includes("pg_advisory_xact_lock"),
      ),
    ).toBeLessThan(
      mocks.query.mock.calls.findIndex((c) =>
        String(c[0]).includes("SELECT DISTINCT ON"),
      ),
    );
  });
  it("throttles worker across all supervisors and binds retry key to exact request", async () => {
    const first = await nativeOperationsService.request(admin, {
      ...input(),
      siteId: 3,
      ticketId: 7,
    });
    grants = [
      { requesterUserId: 30, workerUserId: 20, siteId: 3, ticketId: 7 },
    ];
    const retry = await nativeOperationsService.request(partner, {
      ...input(),
      siteId: 3,
      ticketId: 7,
      idempotencyKey: nextPhone,
    });
    expect(retry).toMatchObject({ id: first.id, throttled: true });
    expect(history).toHaveLength(1);
    await expect(
      nativeOperationsService.request(admin, {
        ...input(),
        siteId: 3,
        ticketId: 7,
        purpose: "different",
      }),
    ).rejects.toThrow("native.idempotency_conflict");
  });
  it("blocks a fresh result when saved worker consent was revoked", async () => {
    native.duty.active = true;
    native.designatedDeviceId = phone;
    native.bindingVersion = 1;
    const r = await nativeOperationsService.request(admin, input());
    history = [{ ...r, state: "pending", deviceId: phone, bindingVersion: 1 }];
    await expect(
      nativeOperationsService.respond(worker, r.id, {
        deviceId: phone,
        bindingVersion: 1,
        state: "saved",
        location: {
          latitude: 1,
          longitude: 2,
          accuracy: 3,
          capturedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("native.location_sharing_unavailable");
  });
  it("rechecks requester opt out before executing worker result", async () => {
    grants = [
      { requesterUserId: 30, workerUserId: 20, siteId: 3, ticketId: 7 },
    ];
    const r = await nativeOperationsService.request(partner, {
      ...input(),
      kind: "photo",
      siteId: 3,
      ticketId: 7,
    });
    native.designatedDeviceId = phone;
    native.bindingVersion = 1;
    history = [{ ...r, deviceId: phone, bindingVersion: 1 }];
    requesterEnabled = false;
    await expect(
      nativeOperationsService.respond(worker, r.id, {
        deviceId: phone,
        bindingVersion: 1,
        state: "opened",
      }),
    ).rejects.toThrow("native.company_opted_out");
  });
  it("moves pending requests when phone changes and leaves started upload bound to original", async () => {
    const a = await nativeOperationsService.request(admin, {
      ...input(),
      kind: "photo",
      ticketId: 7,
    });
    history = [
      { ...a, deviceId: phone, bindingVersion: 1 },
      {
        ...a,
        id: nextPhone,
        state: "upload-in-progress",
        deviceId: phone,
        bindingVersion: 1,
        uploadStartedAt: new Date().toISOString(),
      },
    ];
    native.designatedDeviceId = phone;
    native.bindingVersion = 1;
    await nativeOperationsService.device(worker, nextPhone);
    expect(history.find((r) => r.id === a.id)).toMatchObject({
      deviceId: nextPhone,
      bindingVersion: 2,
    });
    expect(history.find((r) => r.id === nextPhone)).toMatchObject({
      deviceId: phone,
      bindingVersion: 1,
    });
  });
  it("rejects invented canonical photo receipt before marking saved", async () => {
    const r = await nativeOperationsService.request(admin, {
      ...input(),
      kind: "photo",
      ticketId: 7,
    });
    native.designatedDeviceId = phone;
    native.bindingVersion = 1;
    history = [
      {
        ...r,
        state: "upload-in-progress",
        deviceId: phone,
        bindingVersion: 1,
        uploadStartedAt: new Date().toISOString(),
      },
    ];
    await expect(
      nativeOperationsService.respond(worker, r.id, {
        deviceId: phone,
        bindingVersion: 1,
        state: "saved",
        noteId: 4,
        operationId: key,
        objectPath: "/objects/uploads/" + key,
        photoSource: "camera",
      }),
    ).rejects.toThrow("native.photo_association_not_found");
    expect(history[0].state).toBe("upload-in-progress");
  });
  it("renews the exact photo upload path and preserves immutable file hash on the original phone", async () => {
    const r = await nativeOperationsService.request(admin, {
      ...input(),
      kind: "photo",
      ticketId: 7,
    });
    native.designatedDeviceId = phone;
    native.bindingVersion = 1;
    history = [{ ...r, state: "opened", deviceId: phone, bindingVersion: 1 }];
    const grantInput = {
      deviceId: phone,
      bindingVersion: 1,
      contentType: "image/jpeg",
      byteSize: 100,
      checksumSha256: "a".repeat(64),
    };
    const first = await nativeOperationsService.photoUpload(
      worker,
      r.id,
      grantInput,
    );
    expect(first.operationId).toBe(r.id);
    expect(history[0].state).toBe("upload-in-progress");
    native.designatedDeviceId = nextPhone;
    native.bindingVersion = 2;
    history[0] = {
      ...history[0],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const renewal = await nativeOperationsService.photoUpload(
      worker,
      r.id,
      grantInput,
    );
    expect(renewal.objectPath).toBe(first.objectPath);
    expect(renewal.uploadURL).not.toBe(first.uploadURL);
    await expect(
      nativeOperationsService.photoUpload(worker, r.id, {
        ...grantInput,
        checksumSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("native.upload_content_conflict");
  });
});

describe("native duty source revocation", () => {
  it("stops scheduled duty when the exact assigned shift disappears", async () => {
    native.duty = {
      ...native.duty,
      active: true,
      mode: "scheduled",
      shiftId: key,
    };
    const result = await nativeOperationsService.status(worker);
    expect(result.duty.active).toBe(false);
    expect(
      mocks.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("a.status IN('assigned','accepted')") &&
          String(sql).includes("sh.id=$1"),
      ),
    ).toBe(true);
  });
  it("stops ticket duty after own live ticket assignment is revoked", async () => {
    native.duty = { ...native.duty, active: true, mode: "ticket", ticketId: 7 };
    const result = await nativeOperationsService.status(worker);
    expect(result.duty.active).toBe(false);
    expect(
      mocks.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes("SELECT status,lifecycle_state") &&
          String(sql).includes("tc.removed_at IS NULL"),
      ),
    ).toBe(true);
  });
  it("persists worker automatic arrival consent independently and refuses company default opt-out", async () => {
    await nativeOperationsService.consent(worker, {
      locationSharing: true,
      automaticArrival: true,
    });
    expect(native.consent).toEqual({
      locationSharing: true,
      automaticArrival: true,
    });
    await expect(
      authorizeNativeAutomaticArrival(worker, 7, {
        deviceId: phone,
        bindingVersion: native.bindingVersion,
      }),
    ).rejects.toThrow("native.automatic_arrival_opt_in_required");
  });
});

it("worker-wide throttle does not disclose another site's request", async () => {
  grants = [{ requesterUserId: 30, workerUserId: 20, siteId: 3, ticketId: 7 }];
  const hidden = {
    ...(await nativeOperationsService.request(admin, input())),
    siteId: 99,
    ticketId: 99,
    purpose: "Private other site",
    result: { location: { latitude: 1, longitude: 2 } },
  };
  history = [hidden as NativeRequest];
  await expect(
    nativeOperationsService.request(partner, {
      ...input(),
      siteId: 3,
      ticketId: 7,
      idempotencyKey: nextPhone,
    }),
  ).rejects.toMatchObject({ code: "native.location_throttled", status: 429 });
});

describe("continuous GPS privacy enforcement", () => {
  it("rejects EndDuty override without storing a legacy client's GPS", async () => {
    native.duty.overrideEndedAt = new Date().toISOString();
    const save = vi.fn();
    await expect(
      withNativeLocationCollection(worker, undefined, save),
    ).rejects.toThrow("native.duty_ended");
    expect(save).not.toHaveBeenCalled();
  });
  it("requires exact current work phone header and saved consent on enrolled GPS", async () => {
    native.designatedDeviceId = phone;
    native.consent.locationSharing = true;
    native.duty.active = true;
    native.duty.mode = "manual";
    const save = vi.fn(async () => "saved");
    await expect(
      withNativeLocationCollection(worker, undefined, save),
    ).rejects.toThrow("native.work_phone_changed");
    await expect(
      withNativeLocationCollection(worker, nextPhone, save),
    ).rejects.toThrow("native.work_phone_changed");
    expect(await withNativeLocationCollection(worker, phone, save)).toBe(
      "saved",
    );
    native.consent.locationSharing = false;
    await expect(
      withNativeLocationCollection(worker, phone, save),
    ).rejects.toThrow("native.location_collection_disabled");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
it("own shift response atomically saves canonical status and immutable retry receipt", async () => {
  const base = mocks.query.getMockImplementation()!;
  let prior: any,
    assignmentStatus = "assigned";
  mocks.query.mockImplementation(async (sql: string, args: any[] = []) => {
    if (sql.includes("SELECT sh.*"))
      return {
        rows: [
          {
            id: key,
            ends_at: new Date(Date.now() + 3600_000),
            milestone_status: "upcoming",
          },
        ],
      };
    if (sql.includes("SELECT id,status FROM work_hub_shift_assignments"))
      return { rows: [{ id: phone, status: assignmentStatus }] };
    if (sql.includes("target_type='native-shift-response'"))
      return { rows: prior ? [prior] : [] };
    if (sql.includes("UPDATE work_hub_shift_assignments")) {
      assignmentStatus = args[1];
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO assistant_action_audit")) {
      prior = {
        user_id: args[0],
        tool_input: JSON.parse(args[3]),
        tool_output: JSON.parse(args[4]),
      };
      return { rows: [] };
    }
    return base(sql, args);
  });
  const body = {
    operationId: nextPhone,
    response: "declined",
    reason: "Unavailable",
  };
  const result = await nativeOperationsService.shiftResponse(worker, key, body);
  expect(result).toMatchObject({
    assignmentId: phone,
    status: "declined",
    reason: "Unavailable",
  });
  expect(assignmentStatus).toBe("declined");
  expect(
    await nativeOperationsService.shiftResponse(worker, key, body),
  ).toEqual(result);
  await expect(
    nativeOperationsService.shiftResponse(worker, key, {
      ...body,
      reason: "Changed",
    }),
  ).rejects.toThrow("native.idempotency_conflict");
  memberships = false;
  await expect(
    nativeOperationsService.shiftResponse(worker, key, body),
  ).rejects.toThrow("native.membership_required");
});
