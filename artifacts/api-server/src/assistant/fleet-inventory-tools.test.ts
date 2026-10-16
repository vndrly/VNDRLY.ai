import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FLEET_INVENTORY_ACTIONS, FLEET_INVENTORY_TOOLS, fleetInventoryCommand, fleetInventoryOperationId } from "./fleet-inventory-tools";
import { chatGptActionTools, chatGptReadableTools } from "./chatgpt-tool-access";
import { sanitizeChatGptActionInput, validateChatGptActionInput } from "./chatgpt-write-capabilities";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { readFleetInventoryAction, recoverFleetInventoryAction } from "./fleet-inventory-action-recovery";
import { workspaceRequest, workspaceOutput } from "./chatgpt-workspace";

const session = { userId: 1, vendorId: 7, role: "vendor", membershipRole: "admin" };
const assetId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const fields = { name: "Truck 17", manufacturer: "Maker", model: "Model", category: "truck", legalOwner: "Company", identifier: { kind: "vin", value: "VIN17" } };
const detail = { canManage: true, asset: { id: assetId, name: fields.name, manufacturer: fields.manufacturer, model: fields.model, category: "truck", legalOwner: fields.legalOwner, status: "available", version: 1, held: false, fleetIds: [], aliases: [fields.identifier], currentHolderUserId: null }, history: [], runs: [], maintenance: [], historyLimited: false };

describe("Fleet Inventory exact prepared actions", () => {
  it("does not silently expand existing write grants and separates reads", () => {
    expect(chatGptReadableTools(session, ["fleet:read"]).map(t => t.name)).toContain("query_fleet_inventory_detail");
    for (const scopes of [["fleet:read"], ["fleet:dispatch"], ["fleet:admin"], ["assets:write"]]) expect(chatGptActionTools(session, scopes).some(t => (FLEET_INVENTORY_ACTIONS as readonly string[]).includes(t.name))).toBe(false);
    expect(chatGptActionTools(session, ["fleet:inventory"]).filter(t => (FLEET_INVENTORY_ACTIONS as readonly string[]).includes(t.name))).toHaveLength(3);
    expect(chatGptActionTools({ ...session, role: "partner" }, ["fleet:inventory"])).toHaveLength(0);
    for (const tool of FLEET_INVENTORY_TOOLS.filter(t => t.mutating)) expect(tool.confirmation).toBe("required");
  });
  it("binds reviewed creation to server confirmation and rejects authority/custody injection", () => {
    const name = FLEET_INVENTORY_ACTIONS[0];
    const sanitized = sanitizeChatGptActionInput(name, { ...fields, operationId, confirmed: true });
    expect(sanitized).toEqual(fields);
    expect(() => validateChatGptActionInput(name, sanitized)).not.toThrow();
    const input = bindWorkHubToolScope({ ...sanitized, operationId }, session, name);
    expect(resolveExecutableWorkHubToolRequest(name, input, false, session)).toHaveProperty("requiresConfirmation", true);
    expect(resolveExecutableWorkHubToolRequest(name, input, true, session)).toMatchObject({ method: "POST", path: "/fleet/inventory", body: { ...fields, operationId } });
    for (const extra of [{ companyId: 99 }, { owner: { type: "vendor", id: 99 } }, { fleetId: assetId }, { currentHolderUserId: 3 }, { held: false }]) {
      expect(() => validateChatGptActionInput(name, { ...fields, ...extra })).toThrow();
      expect(resolveExecutableWorkHubToolRequest(name, { ...input, ...extra }, true, session)).toHaveProperty("error");
    }
  });
  it("requires exact current version for enrollment/edit and preserves UUID pagination", () => {
    for (const [name, body, method, path] of [
      [FLEET_INVENTORY_ACTIONS[1], { assetId, expectedVersion: 2 }, "POST", `/fleet/inventory/${assetId}/enroll`],
      [FLEET_INVENTORY_ACTIONS[2], { assetId, expectedVersion: 2, name: "Reviewed", manufacturer: "", model: "" }, "PATCH", `/fleet/inventory/${assetId}`],
    ] as const) {
      expect(resolveExecutableWorkHubToolRequest(name, { ...body, operationId }, true, session)).toMatchObject({ method, path });
      expect(resolveExecutableWorkHubToolRequest(name, { ...body, expectedVersion: 0, operationId }, true, session)).toHaveProperty("error");
    }
    expect(resolveExecutableWorkHubToolRequest("query_fleet_inventory", { after: assetId }, false, session)).toMatchObject({ path: `/fleet/inventory?after=${assetId}` });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_inventory", { after: "0:10" }, false, session)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("query_fleet_inventory_detail", { assetId, companyId: 99 }, false, session)).toHaveProperty("error");
    expect(() => validateChatGptActionInput(FLEET_INVENTORY_ACTIONS[2], { assetId, expectedVersion: 1, name: "Changed" })).toThrow();
  });
  it("derives the same domain operation for normal typed/voice confirmation and readback without a model UUID", async () => {
    const name = FLEET_INVENTORY_ACTIONS[0];
    const bound = { ...fields, idempotencyKey: "typed-server-owned-action-17", voiceSessionId: "conversation:17", confirmed: true };
    expect(resolveExecutableWorkHubToolRequest(name, bound, false, session)).toHaveProperty("requiresConfirmation", true);
    const command = resolveExecutableWorkHubToolRequest(name, bound, true, session)!;
    expect(command).toMatchObject({ method: "POST", path: "/fleet/inventory", body: fields });
    if ("error" in command) throw Error(command.error);
    const domainId = fleetInventoryOperationId(bound);
    expect(command.body.operationId).toBe(domainId);
    expect(fleetInventoryOperationId({ ...bound, operationId })).toBe(domainId);
    const receipt = { operationId: domainId, assetId, version: 1, fleetVersion: 1, fingerprint: createHash("sha256").update(JSON.stringify(["create", null, session.userId, session.vendorId, command.body])).digest("hex") };
    expect(await readFleetInventoryAction(name, fields, domainId, session, vi.fn().mockResolvedValueOnce(receipt).mockResolvedValueOnce(detail))).toMatchObject({ verified: true });
    const tokenHash = "a".repeat(64);
    expect(fleetInventoryOperationId({ idempotencyKey: `chatgpt:${tokenHash}` })).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
  it("verifies an independently read exact actor/company command receipt and current canonical asset", async () => {
    const name = FLEET_INVENTORY_ACTIONS[0], command = fleetInventoryCommand(name, fields, operationId);
    const receipt = { operationId, assetId, version: 1, fleetVersion: 2, fingerprint: createHash("sha256").update(JSON.stringify(["create", null, session.userId, session.vendorId, command.body])).digest("hex") };
    const request = vi.fn().mockResolvedValueOnce(receipt).mockResolvedValueOnce(detail);
    expect(await readFleetInventoryAction(name, fields, operationId, session, request)).toMatchObject({ verified: true, readback: detail });
    expect(request.mock.calls.map(call => call.slice(0, 3))).toEqual([[`/fleet/inventory/operations/${operationId}`, "GET", {}], [`/fleet/inventory/${assetId}`, "GET", {}]]);
    for (const change of [{ fingerprint: "a".repeat(64) }, { operationId: assetId }]) await expect(readFleetInventoryAction(name, fields, operationId, session, vi.fn().mockResolvedValue({ ...receipt, ...change }))).rejects.toThrow();
    await expect(readFleetInventoryAction(name, fields, operationId, session, vi.fn().mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ...detail, canManage: false }))).rejects.toThrow();
    await expect(readFleetInventoryAction(name, fields, operationId, { ...session, vendorId: 8 }, vi.fn().mockResolvedValue(receipt))).rejects.toThrow();
    await expect(readFleetInventoryAction(name, fields, operationId, { ...session, userId: 8 }, vi.fn().mockResolvedValue(receipt))).rejects.toThrow();
  });
  it("recovers unknown outcomes through GET only and refuses missing or revoked consent", async () => {
    const action = { toolName: FLEET_INVENTORY_ACTIONS[0], tokenHash: "a".repeat(64), arguments: fields };
    const request = vi.fn().mockRejectedValue(Error("not found"));
    expect(await recoverFleetInventoryAction(action, session, ["fleet:inventory"], request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toBe("GET");
    request.mockClear();
    expect(await recoverFleetInventoryAction(action, session, ["fleet:dispatch"], request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const hex = action.tokenHash.slice(0, 32);
    const exactOperation = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const command = fleetInventoryCommand(action.toolName, fields, exactOperation);
    const fingerprint = createHash("sha256").update(JSON.stringify(["create", null, session.userId, session.vendorId, command.body])).digest("hex");
    const successful = vi.fn().mockResolvedValueOnce({ operationId: exactOperation, assetId, version: 1, fleetVersion: 1, fingerprint }).mockResolvedValueOnce(detail);
    expect(await recoverFleetInventoryAction(action, session, ["fleet:inventory"], successful)).toMatchObject({ verified: true, assetId });
    expect(successful.mock.calls.every(call => call[1] === "GET")).toBe(true);
  });
  it("renders scoped Fleet Inventory history, rejects wrong targets and states page limits", () => {
    expect(workspaceRequest({ view: "fleet_inventory", after: assetId })).toMatchObject({ sourceTool: "query_fleet_inventory", sourceArguments: { after: assetId } });
    const output = workspaceOutput("fleet_inventory", "query_fleet_inventory", {}, { canManage: true, version: 1, fleets: [], assets: [detail.asset], nextCursor: assetId });
    expect(output.metrics).toEqual([{ label: "Assets on this page", value: 1 }]);
    expect(output.attention[0].detail).toContain(assetId);
    expect(output.sections[0].rows[0].assetId).toBe(assetId);
    expect(() => workspaceOutput("fleet_inventory_detail", "query_fleet_inventory_detail", { assetId: operationId }, detail)).toThrow();
    expect(workspaceOutput("fleet_inventory_detail", "query_fleet_inventory_detail", { assetId }, { ...detail, historyLimited: true }).attention[0].title).toBe("Limited history");
  });
});
