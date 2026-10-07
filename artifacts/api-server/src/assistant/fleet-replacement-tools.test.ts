import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
const session = { userId: 1, role: "vendor", membershipRole: "admin" };
describe("Fleet replacement typed assistant boundary", () => {
  it("keeps proposal and own acceptance consents separate", () => {
    const dispatch = chatGptActionTools(session, ["fleet:dispatch"]).map(
        (tool) => tool.name,
      ),
      driver = chatGptActionTools(session, ["fleet:run"]).map(
        (tool) => tool.name,
      );
    expect(dispatch).toContain("prepare_fleet_equipment_replacement");
    expect(dispatch).toContain("cancel_fleet_equipment_replacement");
    expect(dispatch).not.toContain("accept_fleet_equipment_replacement");
    expect(driver).toContain("accept_fleet_equipment_replacement");
    expect(driver).not.toContain("prepare_fleet_equipment_replacement");
    expect(
      chatGptActionTools({ ...session, role: "partner" }, [
        "fleet:dispatch",
        "fleet:run",
      ]).some((tool) => tool.name.includes("equipment_replacement")),
    ).toBe(false);
  });
  it("pins own acceptance and refuses conflict or manufactured authority", () => {
    const input = {
      runId: randomUUID(),
      replacementId: randomUUID(),
      operationId: randomUUID(),
      expectedVersion: 1,
      runExpectedVersion: 4,
      notes: "Actual assigned driver acceptance",
      actorUserId: 99,
      confirmed: true,
    };
    expect(
      resolveExecutableWorkHubToolRequest(
        "accept_fleet_equipment_replacement",
        input,
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "accept_fleet_equipment_replacement",
        input,
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: `/fleet/runs/${input.runId}/replacements/${input.replacementId}/actions`,
      body: {
        operationId: input.operationId,
        expectedVersion: 1,
        runExpectedVersion: 4,
        notes: input.notes,
        action: "accept",
      },
    });
    expect(
      resolveExecutableWorkHubToolRequest(
        "accept_fleet_equipment_replacement",
        { ...input, action: "cancel" },
        true,
        session,
      ),
    ).toHaveProperty("error");
    expect(() =>
      validateChatGptActionInput("accept_fleet_equipment_replacement", {
        ...input,
        action: "cancel",
      }),
    ).toThrow();
  });
  it("filters proposal fields, validates exact IDs and uses read-only query", () => {
    const input = {
      runId: randomUUID(),
      operationId: randomUUID(),
      expectedVersion: 4,
      vehicleAssetId: randomUUID(),
      trailerAssetId: null,
      reason: "Actual paused replacement",
      holderUserId: 99,
    };
    const request = resolveExecutableWorkHubToolRequest(
      "prepare_fleet_equipment_replacement",
      input,
      true,
      session,
    );
    expect(request).toMatchObject({
      method: "POST",
      path: `/fleet/runs/${input.runId}/replacements`,
    });
    expect(request && "body" in request && request.body).not.toHaveProperty(
      "holderUserId",
    );
    expect(() =>
      validateChatGptActionInput("prepare_fleet_equipment_replacement", input),
    ).not.toThrow();
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_equipment_replacements",
        { runId: "../../users" },
        false,
        session,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_equipment_replacements",
        { runId: input.runId },
        false,
        session,
      ),
    ).toMatchObject({
      method: "GET",
      path: `/fleet/runs/${input.runId}/replacements`,
    });
  });
});
