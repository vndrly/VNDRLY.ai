import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), ensure: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
vi.mock("./gate-watch-ticket", () => ({ ensureGateWatchTicket: mocks.ensure }));
vi.mock("../work-hub/required-work-guard", () => ({ assertRequiredWorkClear: vi.fn() }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import { assumeGateWatch } from "./gate-change-over";

beforeEach(() => { vi.clearAllMocks(); });
function fixture(receipt: unknown = null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT row_to_json")) return { rows: [{ station: { id: "gate", site_id: 5, active: true }, site: { id: 5, partner_id: 3 }, account: { display_name: "Worker" } }] };
    if (sql.startsWith("SELECT * FROM gate_stations")) return { rows: [{ id: "gate", site_id: 5, active: true }] };
    if (sql.startsWith("SELECT id, role, session_version")) return { rows: [{ id: 8, role: "admin", session_version: 1, suspended_at: null }] };
    if (sql.startsWith("SELECT id, name, partner_id")) return { rows: [{ id: 5, name: "Site", partner_id: 3 }] };
    if (sql.startsWith("SELECT id FROM user_org_memberships")) return { rows: [{ id: 4 }], rowCount: 1 };
    if (sql.startsWith("SELECT result_json")) return { rows: receipt ? [{ result_json: receipt }] : [] };
    if (sql.startsWith("INSERT INTO gate_shifts")) return { rows: [{ id: "watch" }] };
    if (sql.startsWith("INSERT INTO gate_duty_sessions")) return { rows: [{ id: "duty" }] };
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  mocks.connect.mockResolvedValue(client);
  mocks.ensure.mockResolvedValue({ ticketId: 99, shiftId: "scheduled", ticketBlocker: null });
  return client;
}
const session = { userId: 8, vendorId: 7, role: "vendor", membershipRole: "admin", activeMembershipId: 4, sv: 1 };
const input = { stationId: "gate", operationId: "op", source: "web" as const };

it("returns the automatic ticket when Assume Watch confirms it", async () => {
  const client = fixture();
  const result = await assumeGateWatch(session, input);
  expect(result).toMatchObject({ ticketId: 99, shiftId: "scheduled" });
  expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(client, session, "gate", 5);
  expect(client.query).toHaveBeenLastCalledWith("COMMIT");
});

it("saves the watch and its ticket blocker if ticket prerequisites prevent creation", async () => {
  const client = fixture();
  mocks.ensure.mockResolvedValue({ ticketId: null, shiftId: "scheduled", ticketBlocker: "gate_ticket.approved_service_required" });
  await expect(assumeGateWatch(session, input)).resolves.toMatchObject({ id: "duty", ticketId: null, ticketStatus: "unavailable", ticketBlocker: "gate_ticket.approved_service_required" });
  expect(client.query).toHaveBeenLastCalledWith("COMMIT");
});

it("returns the durable receipt on a retry without opening another ticket", async () => {
  fixture({ stationId: "gate", vendorId: 7, partnerId: null, ticketId: 99, command: JSON.stringify(input) });
  expect(await assumeGateWatch(session, input)).toMatchObject({ ticketId: 99 });
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it.each([{ userId: 8, role: "admin", sv: 1 }, { userId: 8, role: "partner", partnerId: 3, activeMembershipId: 4, sv: 1 }])("preserves non-vendor custody without inventing or requiring a vendor ticket (%j)", async (actor) => {
  const client = fixture();
  const result = await assumeGateWatch(actor, input);
  expect(result).toMatchObject({ id: "duty", ticketId: null, ticketStatus: "unavailable", ticketBlocker: "gate_ticket.vendor_context_required" });
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenLastCalledWith("COMMIT");
});
