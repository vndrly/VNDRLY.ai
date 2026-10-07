import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), resolve: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: {},
  workHubPreferencesTable: {},
  workHubClientOperationsTable: {},
  workHubMessagesTable: {},
  workHubMessageMetadataTable: {},
}));
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: mocks.validate,
}));
vi.mock("../work-hub/queries", () => ({ resolveChannelAccess: mocks.resolve }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
import {
  authorizeAwayResponderInTransaction,
  awayActor,
} from "./work-hub-away-responder-repository";
import type { SessionPayload } from "../lib/session";
const session = {
  userId: 17,
  sv: 1,
  activeMembershipId: 12,
  vendorId: 4,
  role: "field_employee",
  membershipRole: "field_employee",
  iat: 1,
  exp: 2,
} as SessionPayload;
const channelId = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue(session);
  mocks.resolve.mockResolvedValue({
    channel: { ownerOrgType: "vendor", ownerOrgId: 4 },
  });
});
function transaction(joined = true) {
  const execute = vi.fn(async () => ({
    rows: joined ? [{ id: "fixture" }] : [],
  }));
  return { execute } as unknown as Parameters<
    typeof authorizeAwayResponderInTransaction
  >[0];
}
it("uses the same locked transaction for persisted context and existing canonical channel.write policy", async () => {
  const tx = transaction();
  expect(
    await authorizeAwayResponderInTransaction(tx, session, awayActor(session), [
      channelId,
    ]),
  ).toBe(true);
  expect(mocks.validate).toHaveBeenCalledWith(session, tx);
  expect(mocks.resolve).toHaveBeenCalledWith(
    session,
    channelId,
    "channel.write",
    tx,
  );
  expect(tx.execute).toHaveBeenCalledTimes(6);
});
it("requires an explicit joined member even if organization-wide channel policy would permit a manual send", async () => {
  await expect(
    authorizeAwayResponderInTransaction(
      transaction(false),
      session,
      awayActor(session),
      [channelId],
    ),
  ).rejects.toThrow("current_authority_required");
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("rejects current membership/context changes before channel reads or any reply effect", async () => {
  mocks.validate.mockResolvedValue({ ...session, activeMembershipId: 99 });
  await expect(
    authorizeAwayResponderInTransaction(
      transaction(),
      session,
      awayActor(session),
      [channelId],
    ),
  ).rejects.toThrow("current_authority_required");
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("rejects revoked session authority, cross-company channel, and current canonical channel denial", async () => {
  mocks.validate.mockRejectedValueOnce(Error("access_denied"));
  await expect(
    authorizeAwayResponderInTransaction(
      transaction(),
      session,
      awayActor(session),
      [channelId],
    ),
  ).rejects.toThrow("access_denied");
  mocks.resolve.mockResolvedValueOnce({
    channel: { ownerOrgType: "vendor", ownerOrgId: 99 },
  });
  await expect(
    authorizeAwayResponderInTransaction(
      transaction(),
      session,
      awayActor(session),
      [channelId],
    ),
  ).rejects.toThrow("current_authority_required");
  mocks.resolve.mockRejectedValueOnce(Error("channel denied"));
  await expect(
    authorizeAwayResponderInTransaction(
      transaction(),
      session,
      awayActor(session),
      [channelId],
    ),
  ).rejects.toThrow("channel denied");
});
