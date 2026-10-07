import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import {
  sanitizeChatGptActionInput,
  validateChatGptActionInput,
} from "./chatgpt-write-capabilities";
const session = {
  userId: 3,
  role: "vendor",
  vendorId: 7,
  membershipRole: "admin",
};
it("requires existing confirmation and forwards both merge CAS revisions and server UUID", () => {
  const raw = {
    assetId: randomUUID(),
    action: "merge",
    expectedVersion: 2,
    payload: {
      mergedAssetId: randomUUID(),
      mergedExpectedVersion: 4,
      reason: "Reviewed duplicate",
    },
  };
  const input = sanitizeChatGptActionInput("confirm_asset_custody_action", {
    ...raw,
    operationId: randomUUID(),
    confirmed: true,
  });
  validateChatGptActionInput("confirm_asset_custody_action", input);
  expect(
    resolveExecutableWorkHubToolRequest(
      "confirm_asset_custody_action",
      input,
      false,
      session,
    ),
  ).toHaveProperty("requiresConfirmation", true);
  const op = randomUUID();
  expect(
    resolveExecutableWorkHubToolRequest(
      "confirm_asset_custody_action",
      { ...input, operationId: op },
      true,
      session,
    ),
  ).toMatchObject({
    method: "POST",
    path: `/implementation-a/assets/${raw.assetId}/merge`,
    body: {
      operationId: op,
      expectedVersion: 2,
      mergedExpectedVersion: 4,
      mergedAssetId: raw.payload.mergedAssetId,
      confirmed: true,
    },
  });
  expect(() =>
    validateChatGptActionInput("confirm_asset_custody_action", {
      ...input,
      payload: { ...raw.payload, mergedExpectedVersion: undefined },
    }),
  ).toThrow();
});
it("prepares current policy read and accepts revision zero only for strict explicit policy commands", () => {
  const input = {
    action: "policy",
    expectedVersion: 0,
    payload: {
      category: "truck",
      policy: {
        identifierRequired: true,
        photosRequiredOnCheckout: true,
        photosRequiredOnReturn: false,
        supervisorApprovalRequired: true,
        expectedReturnRequired: false,
      },
    },
  };
  validateChatGptActionInput("confirm_asset_custody_action", input);
  expect(
    resolveExecutableWorkHubToolRequest(
      "prepare_asset_custody_action",
      input,
      false,
      session,
    ),
  ).toMatchObject({
    method: "GET",
    path: "/implementation-a/assets/policies/truck",
  });
  expect(
    resolveExecutableWorkHubToolRequest(
      "confirm_asset_custody_action",
      { ...input, operationId: randomUUID() },
      true,
      session,
    ),
  ).toMatchObject({
    method: "PUT",
    body: { expectedVersion: 0, policy: input.payload.policy, confirmed: true },
  });
  expect(() =>
    validateChatGptActionInput("confirm_asset_custody_action", {
      ...input,
      payload: {
        ...input.payload,
        policy: { ...input.payload.policy, owner: { type: "vendor", id: 8 } },
      },
    }),
  ).toThrow();
});
