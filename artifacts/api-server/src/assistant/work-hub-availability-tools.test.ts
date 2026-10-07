import { describe, expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import {
  chatGptActionTools,
  chatGptReadableTools,
} from "./chatgpt-tool-access";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
import type { SessionPayload } from "../lib/session";
const session = {
  userId: 2,
  vendorId: 7,
  role: "field_employee",
  membershipRole: "field_employee",
  vendorPeopleId: 22,
  activeMembershipId: 12,
  sv: 3,
} as SessionPayload;
const input = {
  recordId: null,
  expectedFingerprint: "a".repeat(64),
  window: {
    plannedStartAt: "2026-10-10T10:00:00Z",
    plannedEndAt: "2026-10-10T11:00:00Z",
    timezone: "UTC",
  },
  available: true,
};
describe("current own WorkHub availability callable tool boundary", () => {
  it("exposes only own active worker scope and maps exact trusted UUID command", () => {
    expect(
      chatGptActionTools(session, ["work_hub:write"]).some(
        (t) => t.name === "manage_work_hub_availability",
      ),
    ).toBe(true);
    expect(
      chatGptReadableTools(session, ["work_hub:read"]).some(
        (t) => t.name === "query_work_hub_availability",
      ),
    ).toBe(true);
    for (const s of [
      { ...session, role: "partner", partnerId: 8, vendorId: undefined },
      { ...session, role: "vendor", membershipRole: "admin" },
      { ...session, vendorPeopleId: undefined },
    ] as SessionPayload[])
      expect(
        chatGptActionTools(s, ["work_hub:write"]).some(
          (t) => t.name === "manage_work_hub_availability",
        ),
      ).toBe(false);
    expect(
      chatGptActionTools(session, []).some(
        (t) => t.name === "manage_work_hub_availability",
      ),
    ).toBe(false);
    const fields = sanitizeChatGptActionInput("manage_work_hub_availability", {
      ...input,
      operationId: "model",
      confirmed: true,
    });
    expect(fields).toEqual(input);
    expect(() =>
      validateChatGptActionInput("manage_work_hub_availability", fields),
    ).not.toThrow();
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_work_hub_availability",
        { ...fields, operationId: "11111111-1111-4111-8111-111111111111" },
        true,
        session,
      ),
    ).toMatchObject({
      method: "POST",
      path: "/work-hub/availability",
      body: { ...input, operationId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_work_hub_availability",
        {},
        false,
        session,
      ),
    ).toMatchObject({ method: "GET", path: "/work-hub/availability" });
  });
  it("rejects other-user fields and incomplete model fields before HTTP", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_work_hub_availability",
        { userId: 9 },
        false,
        session,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_work_hub_availability",
        input,
        true,
        session,
      ),
    ).toHaveProperty("error");
    expect(() =>
      validateChatGptActionInput("manage_work_hub_availability", {
        ...input,
        userId: 9,
      }),
    ).toThrow();
  });
});
