import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MeetingScheduling from "./MeetingScheduling";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  language: "en",
  user: {
    id: 7,
    vendorId: 11,
    role: "vendor",
    activeMembershipId: 2,
    availableMemberships: [{ id: 2, role: "admin" }],
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: m.language },
    t: (key: string, params?: any) => {
      const name = key.split(".")[1] as keyof typeof en.meetingScheduling;
      return (m.language === "es" ? es : en).meetingScheduling[name].replace(
        "{{id}}",
        params?.id ?? "",
      );
    },
  }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "black", border: "gray" }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const occurrence = "10000000-0000-4000-8000-000000000002";
function fill() {
  fireEvent.change(screen.getByLabelText("End time"), {
    target: { value: "13:15" },
  });
  fireEvent.change(screen.getByLabelText("Meeting title"), {
    target: { value: "Synthetic planning" },
  });
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-08" },
  });
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: "2026-10-08" },
  });
  fireEvent.change(screen.getByLabelText("Start time"), {
    target: { value: "13:00" },
  });
}
beforeEach(() => {
  m.current = true;
  m.language = "en";
  m.user.availableMemberships = [{ id: 2, role: "admin" }];
  m.api.mockReset();
  m.api.mockImplementation(async (path: string, init?: any) => {
    if (path.endsWith("/people"))
      return [
        { id: 8, displayName: "Company coworker", sameCompany: true },
        { id: 9, displayName: "Foreign person", sameCompany: false },
      ];
    if (path.includes("/calendar?")) return { meetings: [] };
    if (path.endsWith("/meetings")) {
      const b = JSON.parse(init.body);
      return {
        operationId: b.operationId,
        appliedAt: "2026-10-07T18:00:00Z",
        replayed: false,
        resource: {
          meeting: { id: "10000000-0000-4000-8000-000000000003" },
          occurrence: { id: occurrence },
        },
      };
    }
    return {
      actorUserId: 7,
      canManage: true,
      fingerprint: "a".repeat(64),
      responses: [],
      source: "saved_work_hub_participant_response",
      physicalAttendanceVerified: false,
      externalAttendeeAcceptanceVerified: false,
      snapshot: {
        occurrenceId: occurrence,
        meetingId: "10000000-0000-4000-8000-000000000003",
        ownerType: "vendor",
        ownerId: 11,
        title: "Synthetic planning",
        agenda: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        createdById: 7,
        startsAt: new Date(2026, 9, 8, 13, 0).toISOString(),
        endsAt: new Date(2026, 9, 8, 13, 15).toISOString(),
        status: "scheduled",
        participantUserIds: [7, 8],
      },
    };
  });
});
afterEach(cleanup);
describe("native meeting scheduling", () => {
  it("reviews chosen times and own company people, saves exact command and verifies snapshot", async () => {
    render(<MeetingScheduling />);
    await screen.findByText("Company coworker");
    expect(screen.queryByText("Foreign person")).toBeNull();
    fill();
    fireEvent.click(screen.getByText("Company coworker"));
    fireEvent.click(screen.getByText("Review meeting"));
    await screen.findByText("Save reviewed meeting");
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByText("Save reviewed meeting"));
    await screen.findByText(/Meeting saved for the reviewed schedule/);
    const body = JSON.parse(
      m.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    );
    expect(body.payload).toEqual({
      title: "Synthetic planning",
      startsAt: new Date(2026, 9, 8, 13, 0).toISOString(),
      endsAt: new Date(2026, 9, 8, 13, 15).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participantUserIds: [8],
      recordingAllowed: false,
    });
    expect(body.owner).toEqual({ type: "vendor", id: 11 });
    expect(m.api.mock.calls.some((c) => c[0].includes(occurrence))).toBe(true);
  });
  it("locks a lost or conflicted response and checks without resending", async () => {
    const base = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (p: string, i?: any) => {
      if (i?.method === "POST")
        throw new Error("409 schedule conflict or lost response");
      return base(p, i);
    });
    render(<MeetingScheduling />);
    await screen.findByText("Company coworker");
    fill();
    fireEvent.click(screen.getByText("Review meeting"));
    fireEvent.click(await screen.findByText("Save reviewed meeting"));
    await screen.findByText("Check saved meetings");
    fireEvent.click(screen.getByText("Check saved meetings"));
    await screen.findByText(
      /Saved result unavailable or no unique matching meeting/,
    );
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
    expect(screen.queryByText("Save reviewed meeting")).toBeNull();
  });
  it("refuses nonadmin and rejects invalid intervals before creation", async () => {
    m.user.availableMemberships = [{ id: 2, role: "member" }];
    const r = render(<MeetingScheduling />);
    expect(m.api).not.toHaveBeenCalled();
    r.unmount();
    m.user.availableMemberships = [{ id: 2, role: "admin" }];
    render(<MeetingScheduling />);
    await screen.findByText("Company coworker");
    fill();
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-10-07" },
    });
    fireEvent.click(screen.getByText("Review meeting"));
    await screen.findByText(/Review unavailable/);
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
  it("drops late results after account scope changes", async () => {
    let finish!: (v: unknown) => void;
    m.api.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<MeetingScheduling />);
    m.current = false;
    finish([{ id: 8, displayName: "Old account", sameCompany: true }]);
    await waitFor(() => expect(screen.queryByText("Old account")).toBeNull());
    expect(screen.getByText("Review meeting")).toHaveProperty("disabled", true);
  });
  it("permits a new explicit review only after canonical pre-effect scheduling refusal", async () => {
    const base = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (p: string, i?: any) => {
      if (i?.method === "POST")
        throw Object.assign(new Error("conflict"), {
          status: 409,
          code: "work_hub.scheduling_conflict",
        });
      return base(p, i);
    });
    render(<MeetingScheduling />);
    await screen.findByText("Company coworker");
    fill();
    fireEvent.click(screen.getByText("Review meeting"));
    fireEvent.click(await screen.findByText("Save reviewed meeting"));
    await screen.findByText(/selected time conflicts/);
    expect(screen.getByText("Review meeting")).toBeTruthy();
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("renders Spanish scheduling controls", async () => {
    m.language = "es";
    render(<MeetingScheduling />);
    await screen.findByText("Company coworker");
    expect(screen.getByText("Programar una reunión")).toBeTruthy();
    expect(screen.getByLabelText("Hora de inicio")).toBeTruthy();
    expect(screen.queryByText("Schedule a meeting")).toBeNull();
  });
});
