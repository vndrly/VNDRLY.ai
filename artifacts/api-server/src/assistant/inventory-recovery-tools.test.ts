import { describe, expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import {
  chatGptActionTools,
  chatGptReadableTools,
} from "./chatgpt-tool-access";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
const assetId = "10000000-0000-4000-8000-000000000001",
  operationId = "20000000-0000-4000-8000-000000000002";
describe("Inventory recovery tool authority", () => {
  it("routes explicit loss report through trusted confirmation with allowlisted fields only", () => {
    const input = {
      assetId,
      operationId,
      action: "loss_report",
      expectedVersion: 3,
      payload: {
        condition: "stolen",
        reason: "User reported actual loss",
        holderUserId: 999,
        latitude: 32,
      },
    };
    expect(
      resolveExecutableWorkHubToolRequest(
        "confirm_asset_custody_action",
        input,
        false,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "confirm_asset_custody_action",
        input,
        true,
      ),
    ).toMatchObject({
      method: "POST",
      path: `/implementation-a/assets/${assetId}/loss-report`,
      body: {
        operationId,
        expectedVersion: 3,
        condition: "stolen",
        reason: "User reported actual loss",
        confirmed: true,
      },
    });
    expect(() =>
      validateChatGptActionInput("confirm_asset_custody_action", input),
    ).not.toThrow();
    expect(() =>
      validateChatGptActionInput("confirm_asset_custody_action", {
        ...input,
        payload: { condition: "missing" },
      }),
    ).toThrow();
  });
  it("binds claim identifier to server operation and never routes ownership transfer", () => {
    const request = resolveExecutableWorkHubToolRequest(
      "confirm_asset_custody_action",
      {
        assetId,
        operationId,
        expectedVersion: 1,
        action: "identifier_claim",
        payload: {
          claimId: assetId,
          alias: { kind: "serial", value: "ACTUAL-SERIAL" },
          reason: "Actual reported collision",
          owner: { type: "vendor", id: 999 },
        },
      },
      true,
    );
    expect(request).toMatchObject({
      path: `/implementation-a/assets/${assetId}/identifier-claims`,
      body: {
        operationId,
        claimId: operationId,
        alias: { kind: "serial", value: "ACTUAL-SERIAL" },
        confirmed: true,
      },
    });
    expect(
      (request as { body: Record<string, unknown> }).body.owner,
    ).toBeUndefined();
  });
  it("advertises mediator resolution and global queue only to platform admins", () => {
    for (const role of ["vendor", "partner", "field_employee"] as const) {
      const tool = chatGptActionTools(
        { userId: 1, role, vendorId: 2, membershipRole: "admin" },
        ["assets:write"],
      ).find((tool) => tool.name === "confirm_asset_custody_action")!;
      expect((tool.inputSchema.properties as any).action.enum).not.toContain(
        "resolve_identifier_claim",
      );
      expect(
        chatGptReadableTools({ userId: 1, role, vendorId: 2 }, [
          "operations:read",
        ]).some((tool) => tool.name === "query_asset_identifier_review_queue"),
      ).toBe(false);
    }
    expect(
      chatGptReadableTools({ userId: 1, role: "admin" }, [
        "operations:read",
      ]).some((tool) => tool.name === "query_asset_identifier_review_queue"),
    ).toBe(true);
  });
  it("requires exact own asset for claim read and corrected alias only for correction", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_asset_identifier_claims",
        {},
        false,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_asset_identifier_claims",
        { assetId },
        false,
      ),
    ).toMatchObject({
      method: "GET",
      path: `/implementation-a/assets/${assetId}/identifier-claims`,
    });
    const input = {
      assetId,
      expectedVersion: 1,
      action: "resolve_identifier_claim",
      payload: {
        claimId: operationId,
        decision: "correct_requester_alias",
        reason: "Human reviewed correction",
      },
    };
    expect(() =>
      validateChatGptActionInput("confirm_asset_custody_action", input),
    ).toThrow();
    expect(() =>
      validateChatGptActionInput("confirm_asset_custody_action", {
        ...input,
        payload: {
          ...input.payload,
          correctedAlias: { kind: "serial", value: "CORRECTED" },
        },
      }),
    ).not.toThrow();
  });
});
