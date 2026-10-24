import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoverageGaps } from "./coverage-gaps";
import { RequestShiftCoverage } from "./request-shift-coverage";
import { classifyCoverage, type CoverageFacts } from "./coverage-gap-model";
import {
  assignedWeekdayCells,
  type ScheduleShift,
} from "./shift-assignment-model";
const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/work-hub-client", async (original) => ({
  ...(await original<any>()),
  workHubRequest: state.request,
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ color, children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "GateGo", primary: "#f1b637" }),
}));
const shift: ScheduleShift = {
  id: "one",
  version: 1,
  title: "Day",
  pattern: "Main Gate Day",
  date: "2099-10-25",
  weekday: 0,
  starts: "06:00",
  ends: "18:00",
  startsAt: "2099-10-25T11:00:00.000Z",
  endsAt: "2099-10-25T23:00:00.000Z",
  timezone: "America/Chicago",
  required: 1,
  assignees: [7],
};
const facts: CoverageFacts = {
  workers: [],
  unavailable: [],
  requests: [],
  urgentShiftIds: [],
  readOnly: true,
};
function mount(node: React.ReactNode) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.request.mockReset();
});
describe("coverage classification", () => {
  it("distinguishes vacancies, holds, departure and personal requests", () => {
    expect(
      classifyCoverage(9, "Gate", [{ ...shift, assignees: [] }], facts)[0]
        .category,
    ).toBe("New / Unassigned Recurring Shifts");
    expect(
      classifyCoverage(9, "Gate", [shift], {
        ...facts,
        workers: [{ userId: 7, state: "hold" }],
      })[0].category,
    ).toBe("Temporary coverage");
    expect(
      classifyCoverage(9, "Gate", [shift], {
        ...facts,
        workers: [{ userId: 7, state: "inactive" }],
      })[0].category,
    ).toBe("Permanent vacancies");
    expect(
      classifyCoverage(9, "Gate", [shift], {
        ...facts,
        requests: [{ id: "request", shiftId: "one", userId: 7 }],
      })[0].category,
    ).toBe("Coverage requests");
  });
  it("does not double count a request during leave and preserves its resolution link", () => {
    const gaps = classifyCoverage(9, "Gate", [shift], {
      ...facts,
      unavailable: [
        { userId: 7, startsAt: shift.startsAt, endsAt: shift.endsAt },
      ],
      requests: [{ id: "request", shiftId: "one", userId: 7 }],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].requestId).toBe("request");
  });
  it("retains recurring ownership when somebody temporarily covers", () => {
    const covered = { ...shift, assignees: [8], recurringAssignees: [7] };
    expect(assignedWeekdayCells([covered], 7).size).toBe(1);
    expect(assignedWeekdayCells([covered], 8).size).toBe(0);
  });
});
describe("coverage board", () => {
  it("combines setup and staffing gaps under one collapsible total", async () => {
    state.request.mockImplementation(async (path) => {
      if (path.includes("coverage-facts")) return facts;
      if (path.includes("/schedule")) return {shifts:path.includes("/9/") ? [{...shift,assignees:[]}] : [],people:[],busy:[],readOnly:true};
      return {sites:[{id:9,name:"Coyote Ridge"},{id:10,name:"New gate"}]};
    });
    mount(<CoverageGaps owner={{type:"vendor",id:5}}/>);
    const category=await screen.findByRole("button",{name:/New \/ Unassigned Recurring Shifts/});
    await waitFor(()=>expect(category.textContent).toContain("2 total"));
    expect(screen.queryByText("Needs gatekeeper")).toBeNull();
    fireEvent.click(category);
    expect(screen.getByText("Needs gatekeeper")).toBeTruthy();
    expect(screen.getByText("Needs shift setup")).toBeTruthy();
    expect(screen.queryByRole("button",{name:/New \/ unscheduled locations/})).toBeNull();
    fireEvent.click(category);
    expect(screen.queryByText("Needs gatekeeper")).toBeNull();
    expect(screen.queryByText("Needs shift setup")).toBeNull();
    expect(state.request.mock.calls.every(c=>!c[1]?.method)).toBe(true);
  });
  function setup(readOnly = true) {
    state.request.mockImplementation(async (path, options) => {
      if (options?.method) return { resource: { id: "saved" } };
      if (path.includes("coverage-facts"))
        return {
          ...facts,
          readOnly,
          requests: [{ id: "request", shiftId: "one", userId: 7 }],
        };
      if (path.includes("/schedule"))
        return {
          shifts: [shift],
          people: [
            { id: 7, name: "Original" },
            { id: 8, name: "Replacement" },
          ],
          busy: [],
          readOnly,
        };
      return { sites: [{ id: 9, name: "Coyote Ridge" }] };
    });
    mount(<CoverageGaps owner={{ type: "vendor", id: 5 }} />);
  }
  it("shows company gaps without a site selector and permits read-only review", async () => {
    setup();
    const category = await screen.findByRole("button", {name:/Coverage requests/});
    await waitFor(()=>expect(category.textContent).toContain("1 total"));
    expect(category.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Coverage category")).toBeNull();
    expect(screen.queryByRole("button", {name:/Coyote Ridge · Main Gate Day/})).toBeNull();
    fireEvent.click(category);
    expect(category.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Coyote Ridge · Main Gate Day/,
      }),
    );
    expect(screen.queryByLabelText("Site location")).toBeNull();
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByText("Review coverage"));
    expect(
      (screen.getByText("Save coverage resolution") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
  });
  it("sends only the reviewed replacement, scope and existing request in a mocked save", async () => {
    setup(false);
    fireEvent.click(await screen.findByRole("button", {name:/Coverage requests/}));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Coyote Ridge · Main Gate Day/,
      }),
    );
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Coverage replacement type"), {
      target: { value: "permanent" },
    });
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
    fireEvent.click(screen.getByText("Review coverage"));
    fireEvent.click(screen.getByText("Save coverage resolution"));
    await waitFor(() =>
      expect(
        state.request.mock.calls.some((c) => c[1]?.method === "POST"),
      ).toBe(true),
    );
    const payload = JSON.parse(
      state.request.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    ).payload;
    expect(payload).toMatchObject({
      shiftId: "one",
      originalUserId: 7,
      replacementUserId: 8,
      kind: "permanent",
      requestId: "request",
    });
  });
  it("requests one own dated shift only after review, without an assignment payload", async () => {
    state.request.mockResolvedValue({
      shifts: [{ ...shift, siteName: "Coyote Ridge", requested: false }],
      readOnly: false,
    });
    mount(
      <RequestShiftCoverage
        owner={{ type: "vendor", id: 5 }}
        day="2099-10-25"
      />,
    );
    fireEvent.click(await screen.findByText("Request coverage"));
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
    fireEvent.click(screen.getByText("Submit coverage request"));
    await waitFor(() =>
      expect(
        state.request.mock.calls.some((c) => c[1]?.method === "POST"),
      ).toBe(true),
    );
    expect(
      JSON.parse(
        state.request.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
      ).payload,
    ).toEqual({ shiftId: "one", expectedVersion: 1 });
  });
});
