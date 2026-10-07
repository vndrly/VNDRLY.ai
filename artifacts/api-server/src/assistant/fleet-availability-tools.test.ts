import { describe, expect, it } from "vitest";
import { FLEET_TOOLS } from "./fleet-tools";
import {
  bindWorkHubToolScope,
  resolveExecutableWorkHubToolRequest,
} from "./work-hub-tool-runtime";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
import {
  chatGptReadableTools,
  chatGptActionTools,
} from "./chatgpt-tool-access";
const session = {
  userId: 1,
  role: "vendor",
  vendorId: 7,
  membershipRole: "admin",
};
const input = {
  driverUserId: 2,
  recordId: null,
  expectedFingerprint: "a".repeat(64),
  window: {
    plannedStartAt: "2026-10-10T10:00:00Z",
    plannedEndAt: "2026-10-10T11:00:00Z",
    timezone: "America/Chicago",
  },
  available: true,
};
describe("Fleet availability prepared action routing", () => {
  it("requires existing separate read and dispatch grants and keeps top-level object schema", () => {
    expect(
      chatGptReadableTools(session, ["fleet:read"]).map((tool) => tool.name),
    ).toContain("query_fleet_driver_availability");
    expect(
      chatGptActionTools(session, ["fleet:read"]).map((tool) => tool.name),
    ).not.toContain("record_fleet_driver_availability");
    expect(
      chatGptActionTools(session, ["fleet:dispatch"]).map((tool) => tool.name),
    ).toContain("record_fleet_driver_availability");
    const tool = FLEET_TOOLS.find(
      (tool) => tool.name === "record_fleet_driver_availability",
    )!;
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(tool.confirmation).toBe("required");
  });
  it("preserves strict business input through binding and posts only exact trusted UUID/body", () => {
    const operationId = "00000000-0000-4000-8000-000000000001";
    const sanitized = sanitizeChatGptActionInput(
      "record_fleet_driver_availability",
      { ...input, operationId: crypto.randomUUID(), confirmed: true },
    );
    expect(sanitized).toEqual(input);
    expect(() =>
      validateChatGptActionInput("record_fleet_driver_availability", sanitized),
    ).not.toThrow();
    const bound = bindWorkHubToolScope(
      { ...sanitized, operationId },
      session,
      "record_fleet_driver_availability",
    );
    expect(
      resolveExecutableWorkHubToolRequest(
        "record_fleet_driver_availability",
        bound,
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "record_fleet_driver_availability",
        bound,
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/fleet/drivers/2/availability",
      body: { operationId, ...input },
    });
    for (const extra of [
      { owner: { type: "vendor", id: 99 } },
      { context: { kind: "organization", id: 99 } },
      { companyId: 99 },
      { action: "remove" },
    ]) {
      expect(() =>
        validateChatGptActionInput("record_fleet_driver_availability", {
          ...input,
          ...extra,
        }),
      ).toThrow();
      expect(
        resolveExecutableWorkHubToolRequest(
          "record_fleet_driver_availability",
          bindWorkHubToolScope(
            { ...input, ...extra, operationId },
            session,
            "record_fleet_driver_availability",
          ),
          true,
          session,
        ),
      ).toHaveProperty("error");
    }
  });
  it("reads only exact driver choices without injected owner or caller context", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_driver_availability",
        bindWorkHubToolScope(
          { driverUserId: 2 },
          session,
          "query_fleet_driver_availability",
        ),
        false,
        session,
      ),
    ).toMatchObject({ method: "GET", path: "/fleet/drivers/2/availability" });
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_driver_availability",
        { driverUserId: 2, companyId: 99 },
        false,
        session,
      ),
    ).toHaveProperty("error");
  });
});
