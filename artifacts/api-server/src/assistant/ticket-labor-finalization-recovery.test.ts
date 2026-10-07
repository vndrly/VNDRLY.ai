import { expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("./chatgpt-tool-access", () => ({ chatGptActionTools: () => access.allowed ? [{ name: "manage_ticket_record" }] : [] }));
import { recoverTicketLaborFinalizationAction } from "./ticket-labor-finalization-recovery";
const session = { userId: 9, role: "vendor", vendorId: 4, sv: 1 };
const action = { toolName: "manage_ticket_record", tokenHash: "a".repeat(64), arguments: { action: "finalize_labor", ticketId: 7, payload: { expectedUpdatedAt: "2026-10-07T10:00:00.000Z" } } };
const saved = { ticketId: 7, operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actorUserId: 9, expectedUpdatedAt: action.arguments.payload.expectedUpdatedAt, updatedAt: "2026-10-07T10:01:00.000Z", closedAt: "2026-10-07T10:01:00.000Z", closedById: 9, autoLaborLineCount: 2, status: "applied", physicalWorkVerified: false, submitted: false };
it("reads only the server-derived exact operation and verified receipt", async () => {
  access.allowed = true;
  const request = vi.fn(async () => ({ receipt: saved }));
  expect(await recoverTicketLaborFinalizationAction(action, session, ["tickets:write"], request as any)).toEqual(saved);
  expect(request).toHaveBeenCalledWith("/tickets/7/close/operations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "GET", {}, session);
});
it("refuses changed actor/version, absent records, extra model operation, and missing current tool authority without an effect", async () => {
  access.allowed = true;
  for (const receipt of [null, { ...saved, actorUserId: 10 }, { ...saved, expectedUpdatedAt: "2026-10-07T09:00:00.000Z" }])
    expect(await recoverTicketLaborFinalizationAction(action, session, [], vi.fn(async () => ({ receipt })) as any)).toBeNull();
  const request = vi.fn();
  expect(await recoverTicketLaborFinalizationAction({ ...action, arguments: { ...action.arguments, operationId: saved.operationId } }, session, [], request as any)).toBeNull();
  access.allowed = false;
  expect(await recoverTicketLaborFinalizationAction(action, session, [], request as any)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
