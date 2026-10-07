import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { gateShiftAssignmentFingerprintValues } from "@workspace/api-zod";
import en from "@/lib/locales/en.json";
import GateShiftAssignments from "./GateShiftAssignments";
const m = vi.hoisted(() => ({ api: vi.fn(), current: true }));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 6, vendorId: 11, activeMembershipId: 2 } }),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) =>
      ((en.gateShiftAssignment as any)[key.split(".")[1]] ?? key).replace(
        "{{version}}",
        params?.version ?? "",
      ),
  }),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha" },
  digestStringAsync: async (_: string, text: string) =>
    createHash("sha256").update(text).digest("hex"),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const id = "10000000-0000-4000-8000-000000000001";
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
let saved: any;
beforeEach(() => {
  m.current = true;
  saved = null;
  m.api.mockReset();
  m.api.mockImplementation(async (path: string, init?: any) => {
    if (path.includes("operations")) return { receipt: saved };
    if (path.endsWith("staffing-candidates")) return choices;
    const input = JSON.parse(init.body);
    saved = {
      ...input,
      actorUserId: 6,
      shiftId: id,
      previousVersion: 3,
      resultingVersion: 4,
      recordedAt: "2026-10-07T18:00:00Z",
      assignmentRecorded: true,
      physicalAttendanceVerified: false,
      commandFingerprint: createHash("sha256")
        .update(
          JSON.stringify(
            gateShiftAssignmentFingerprintValues(id, 6, 11, input),
          ),
        )
        .digest("hex"),
    };
    delete saved.expectedVersion;
    return saved;
  });
});
afterEach(cleanup);
async function review() {
  fireEvent.click(await screen.findByText("Synthetic staff"));
  fireEvent.click(screen.getByText("Review staffing"));
  await screen.findByText("Save reviewed staffing");
}
describe("Gate staffing screen", () => {
  it("explicitly reviews names/version and retains saved outcome when list refresh fails", async () => {
    const pending = vi.fn();
    render(
      <GateShiftAssignments
        shiftId={id}
        onPendingChange={pending}
        onSaved={async () => {
          throw Error("refresh");
        }}
      />,
    );
    await review();
    expect(m.api.mock.calls.some((c) => c[1])).toBe(false);
    expect(screen.getByText(/Reviewed shift version 3/)).toBeTruthy();
    fireEvent.click(screen.getByText("Save reviewed staffing"));
    await screen.findByText("Staffing saved. Refresh the shift list.");
    expect(pending.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("retains unknown attempt on denied readback and never sends POST", async () => {
    const original = m.api.getMockImplementation()!;
    m.api.mockImplementation((path: string, init?: any) =>
      path.includes("operations")
        ? Promise.reject(Error("403"))
        : original(path, init),
    );
    render(<GateShiftAssignments shiftId={id} />);
    await review();
    fireEvent.click(screen.getByText("Save reviewed staffing"));
    await screen.findByText("Check original staffing");
    fireEvent.click(screen.getByText("Check original staffing"));
    await waitFor(() =>
      expect(
        m.api.mock.calls.filter((c) => c[0].includes("operations")),
      ).toHaveLength(2),
    );
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    expect(screen.queryByText("Review current staffing")).toBeNull();
  });
  it("shows missing availability as a prerequisite instead of a selectable candidate", async () => {
    m.api.mockResolvedValue({
      ...choices,
      candidates: [{ ...candidate, availability: "unknown_no_window" }],
    });
    render(<GateShiftAssignments shiftId={id} />);
    expect(
      ((await screen.findByText("Synthetic staff")) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/No recorded availability window/)).toBeTruthy();
  });
});
