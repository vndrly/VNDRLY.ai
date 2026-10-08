import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  userOrgMembershipsTable: {},
  workHubShiftsTable: {},
  workHubShiftAssignmentsTable: {},
  workHubClientOperationsTable: {},
}));
vi.mock("./gate-shift-assignment", () => ({
  gateAssignmentTransactionClient: vi.fn(),
  lockShiftSchedulingRows: vi.fn(),
  authorizeGateSchedulingSite: vi.fn(),
  GateShiftAssignmentError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
}));
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: vi.fn(),
}));
vi.mock("../work-hub/commands", () => ({ executeWorkHubCommand: vi.fn() }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
import { assertShiftOpeningState } from "./work-hub-shift-opening";
import {
  WorkHubShiftOpeningInputSchema,
  workHubShiftOpeningFingerprintValues,
} from "@workspace/api-zod";
describe("existing shift claim window policy", () => {
  const now = Date.parse("2026-10-07T12:00:00Z"),
    shift = {
      startsAt: "2026-10-08T03:00:00Z",
      endsAt: "2026-10-08T04:00:00Z",
      milestoneStatus: "upcoming",
    };
  it("permits only future unassigned nonterminal planning", () => {
    expect(() => assertShiftOpeningState(shift, 0, now)).not.toThrow();
    for (const invalid of [
      { ...shift, milestoneStatus: "cancelled" },
      { ...shift, milestoneStatus: "completed" },
      { ...shift, milestoneStatus: "in_progress" },
      { ...shift, milestoneStatus: "unknown" },
      { ...shift, startsAt: "2026-10-06T03:00:00Z" },
    ])
      expect(() => assertShiftOpeningState(invalid, 0, now)).toThrow(
        "work_hub.invalid_operation",
      );
    expect(() => assertShiftOpeningState(shift, 1, now)).toThrow();
  });
  it("strictly binds desired state and exact version without attendance fields", () => {
    const input = {
      operationId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 2,
      open: true,
    };
    expect(WorkHubShiftOpeningInputSchema.parse(input)).toEqual(input);
    for (const raw of [
      { ...input, open: "true" },
      { ...input, expectedVersion: 0 },
      { ...input, confirmed: true },
      { ...input, latitude: 30 },
    ])
      expect(WorkHubShiftOpeningInputSchema.safeParse(raw).success).toBe(false);
    expect(
      workHubShiftOpeningFingerprintValues(
        "22222222-2222-4222-8222-222222222222",
        1072,
        "vendor",
        1107,
        input,
      ),
    ).toEqual({
      shiftId: "22222222-2222-4222-8222-222222222222",
      actorUserId: 1072,
      ownerOrgType: "vendor",
      ownerOrgId: 1107,
      ...input,
    });
  });
});
