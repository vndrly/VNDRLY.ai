import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  prepareGateAssignment,
  submitGateAssignment,
  GateAssignmentChanged,
} from "./gate-shift-assignment";
const id = "10000000-0000-4000-8000-000000000001",
  op = "10000000-0000-4000-8000-000000000002";
const candidate = {
  vendorPeopleId: 7,
  userId: 8,
  name: "Synthetic staff",
  requirements: [],
  qualificationState: "unknown_no_configured_requirements",
  availability: "recorded_available",
  eligibility: {
    allowed: true,
    code: "workforce.assignment_allowed",
    warnings: [],
    overrideRequired: false,
  },
  contact: { workHubUserId: 8, reachability: "unknown" },
  sourceReference: "vendor_people:7",
};
const choices = {
  shiftId: id,
  shiftVersion: 3,
  siteId: 5,
  startsAt: "2026-10-08T18:00:00Z",
  endsAt: "2026-10-08T19:00:00Z",
  observedAt: "2026-10-07T18:00:00Z",
  candidates: [candidate],
  truncated: false,
  coverage: null,
  assignmentMade: false,
  messageSent: false,
  limitations: [],
  qualificationConfiguration: "none_configured",
};
const digest = async (text: string) =>
  createHash("sha256").update(text).digest("hex");
const prepare = () => prepareGateAssignment(choices, [8], op, 6, 11, digest);
function receipt(a: Awaited<ReturnType<typeof prepare>>) {
  return {
    operationId: op,
    actorUserId: 6,
    shiftId: id,
    previousVersion: 3,
    resultingVersion: 4,
    assigneeUserIds: [8],
    commandFingerprint: a.fingerprint,
    recordedAt: "2026-10-07T18:01:00Z",
    assignmentRecorded: true,
    physicalAttendanceVerified: false,
  };
}
describe("reviewed Gate staffing", () => {
  it("distinguishes unknown certification config and unknown availability from explicit no-cert policy", async () => {
    await expect(prepare()).resolves.toHaveProperty("input.expectedVersion", 3);
    await expect(
      prepareGateAssignment(
        { ...choices, qualificationConfiguration: "unknown" },
        [8],
        op,
        6,
        11,
        digest,
      ),
    ).rejects.toThrow();
    await expect(
      prepareGateAssignment(
        {
          ...choices,
          candidates: [{ ...candidate, availability: "unknown_no_window" }],
        },
        [8],
        op,
        6,
        11,
        digest,
      ),
    ).rejects.toThrow();
    await expect(
      prepareGateAssignment(
        {
          ...choices,
          candidates: [
            {
              ...candidate,
              eligibility: {
                ...candidate.eligibility,
                warnings: ["workforce.rest_window_warning"],
                overrideRequired: true,
              },
            },
          ],
        },
        [8],
        op,
        6,
        11,
        digest,
      ),
    ).rejects.toThrow();
  });
  it("uses exact saved receipt after dropped response without another POST", async () => {
    const a = await prepare(),
      r = receipt(a);
    let saved = false;
    const api = vi.fn(async (path: string, init?: unknown) => {
      if (path.includes("/operations/")) return { receipt: saved ? r : null };
      if (path.endsWith("staffing-candidates")) return choices;
      if (init) {
        saved = true;
        throw Error("dropped");
      }
      throw Error("unexpected");
    });
    await expect(submitGateAssignment(a, api, () => true)).rejects.toThrow(
      "dropped",
    );
    expect(await submitGateAssignment(a, api, () => true)).toEqual(r);
    expect(api.mock.calls.filter((c) => c[1])).toHaveLength(1);
  });
  it("refuses changed shift and denied readback instead of resending", async () => {
    const a = await prepare();
    const api = vi.fn(async (path: string) =>
      path.includes("operations")
        ? { receipt: null }
        : { ...choices, shiftVersion: 4 },
    );
    await expect(
      submitGateAssignment(a, api, () => true),
    ).rejects.toBeInstanceOf(GateAssignmentChanged);
    expect(api.mock.calls.every((c) => c.length === 1)).toBe(true);
    const denied = vi.fn(async () => {
      throw Error("403");
    });
    await expect(submitGateAssignment(a, denied, () => true)).rejects.toThrow(
      "403",
    );
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it("rejects account changes and forged receipt proof", async () => {
    const a = await prepare();
    let current = true;
    const api = vi.fn(async () => {
      current = false;
      return { receipt: receipt(a) };
    });
    await expect(submitGateAssignment(a, api, () => current)).rejects.toThrow(
      "account_changed",
    );
    await expect(
      submitGateAssignment(
        a,
        async () => ({
          receipt: { ...receipt(a), physicalAttendanceVerified: true },
        }),
        () => true,
      ),
    ).rejects.toThrow();
  });
});
