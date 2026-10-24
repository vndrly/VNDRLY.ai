import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoverageGaps } from "./coverage-gaps";
import { CoverageAcknowledgments } from "./coverage-acknowledgments";
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
  it('keeps assigned coverage visible until acknowledged, without duplicate hold gaps',()=>{
    const pending={notificationId:12,shiftId:shift.id,userId:7,name:'Original'};
    const pendingFacts={...facts,awaitingAcknowledgment:[pending],workers:[{userId:7,state:'hold' as const}]};
    const gaps=classifyCoverage(9,'Gate',[shift],pendingFacts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({category:'Awaiting acknowledgment',originalUserId:7,awaitingAcknowledgment:pending});
    expect(classifyCoverage(9,'Gate',[shift],{...facts,awaitingAcknowledgment:[]})).toEqual([]);
    expect(classifyCoverage(9,'Gate',[{...shift,assignees:[8]}],{...facts,awaitingAcknowledgment:[pending]})).toEqual([]);
  });
  it('shows vacancies and departed workers in both normal and urgent lists at the 24 hour boundary',()=>{
    const now=Date.parse(shift.startsAt)-86400000;
    const cases: Array<[ScheduleShift, Partial<CoverageFacts>]> = [[{...shift,assignees:[]},{}],[shift,{workers:[{userId:7,state:'inactive'}]}]];
    for(const [scheduled, extra] of cases){
      const gaps=classifyCoverage(9,'Gate',[scheduled],{...facts,...extra},now);
      expect(gaps.map(g=>g.category)).toEqual(['New / Unassigned Recurring Shifts','Urgent gaps']);
      expect(classifyCoverage(9,'Gate',[scheduled],{...facts,...extra},now-1).map(g=>g.category)).toEqual(['New / Unassigned Recurring Shifts']);
      expect(classifyCoverage(9,'Gate',[scheduled],{...facts,...extra},Date.parse(shift.endsAt))).toEqual([]);
    }
  });
  it('includes holds and approved requests but not pending requests or acknowledgments as urgent',()=>{
    const now=Date.parse(shift.startsAt)-3600000;
    for(const extra of [{workers:[{userId:7,state:'hold' as const}]},{requests:[{id:'r',shiftId:shift.id,userId:7,status:'approved' as const}]}]){
      expect(classifyCoverage(9,'Gate',[shift],{...facts,...extra},now).filter(g=>g.category==='Urgent gaps')).toHaveLength(1);
    }
    for(const extra of [{requests:[{id:'r',shiftId:shift.id,userId:7,status:'pending' as const}]},{awaitingAcknowledgment:[{notificationId:1,shiftId:shift.id,userId:7,name:'Worker'}]}]){
      expect(classifyCoverage(9,'Gate',[shift],{...facts,...extra},now).filter(g=>g.category==='Urgent gaps')).toHaveLength(0);
    }
  });
  it('shows recorded no-shows and abandoned shifts and ignores replaced workers',()=>{
    for(const reason of ['No-show','Abandoned shift'] as const){
      const incident={shiftId:shift.id,userId:7,reason};
      const gaps=classifyCoverage(9,'Gate',[shift],{...facts,incidents:[incident]},Date.parse(shift.startsAt)+1);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toMatchObject({category:'Urgent gaps',originalUserId:7,detail:reason+' — needs coverage.'});
      expect(classifyCoverage(9,'Gate',[{...shift,assignees:[8]}],{...facts,incidents:[incident]})).toEqual([]);
    }
  });
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
    ).toBe("Needs temporary coverage");
    expect(
      classifyCoverage(9, "Gate", [shift], {
        ...facts,
        workers: [{ userId: 7, state: "inactive" }],
      })[0].category,
    ).toBe("New / Unassigned Recurring Shifts");
    expect(
      classifyCoverage(9, "Gate", [shift], {
        ...facts,
        requests: [{ id: "request", shiftId: "one", userId: 7 }],
      })[0].category,
    ).toBe("Shift requested off");
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
  it.each(['Approve','Decline'])('requires %s before offering a request replacement',async action=>{
    let status='pending';
    state.request.mockImplementation(async(path,options)=>{
      if(options?.method){status=JSON.parse(options.body).payload.decision;return {resource:{id:'request',decision:status}};}
      if(path.includes('coverage-facts'))return {...facts,readOnly:false,requests:status==='declined'?[]:[{id:'request',shiftId:'one',userId:7,status}]};
      if(path.includes('coverage-candidates'))return {people:[{id:8,name:'Replacement'}]};
      if(path.includes('/schedule'))return {shifts:[shift],people:[{id:7,name:'Original'}],busy:[],readOnly:false};
      return {sites:[{id:9,name:'Gate'}]};
    });
    mount(<CoverageGaps owner={{type:'vendor',id:5}}/>);
    const category=await screen.findByRole('button',{name:/Shift requested off/});
    await waitFor(()=>expect(category.textContent).toContain('1 total'));
    fireEvent.click(category);fireEvent.click(screen.getByRole('button',{name:/Main Gate Day/}));
    expect(screen.queryByLabelText('Coverage replacement gatekeeper')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:action}));
    if(action==='Approve')await screen.findByLabelText('Coverage replacement gatekeeper');
    else await waitFor(()=>expect(category.textContent).toContain('0 total'));
    const writes=state.request.mock.calls.filter(c=>c[1]?.method);
    expect(writes).toHaveLength(1);expect(writes[0][0]).toBe('/site-shift-plans/decide-shift-off');
  });
  it('shows No shift today when the gatekeeper has no assignment',async()=>{
    state.request.mockResolvedValue({shifts:[],readOnly:false});
    mount(<RequestShiftCoverage owner={{type:'vendor',id:5}} day="2099-10-25"/>);
    expect(await screen.findByText('No shift today')).toBeTruthy();
    expect(screen.queryByText('My shift coverage')).toBeNull();
  });
  it('offers Call, Chat and confirmed reassignment for a pending acknowledgment',async()=>{
    state.request.mockImplementation(async path=>{
      if(path.includes('coverage-facts')) return {...facts,readOnly:false,awaitingAcknowledgment:[{notificationId:12,shiftId:shift.id,userId:7,name:'Original'}]};
      if(path.includes('coverage-candidates')) return {people:[{id:8,name:'Replacement',pickupExtraShifts:true}]};
      if(path.includes('/schedule')) return {shifts:[shift],people:[{id:7,name:'Original'}],busy:[],readOnly:false};
      return {sites:[{id:9,name:'Gate'}]};
    });
    mount(<CoverageGaps owner={{type:'vendor',id:5}}/>);
    const category=await screen.findByRole('button',{name:/Awaiting acknowledgment/});
    await waitFor(()=>expect(category.textContent).toContain('1 total'));
    fireEvent.click(category);
    fireEvent.click(screen.getByRole('button',{name:/Main Gate Day/}));
    expect(screen.getByRole('button',{name:'Call'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Chat'})).toBeTruthy();
    expect(screen.queryByLabelText('Coverage replacement gatekeeper')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Reassign'}));
    await screen.findByRole('option',{name:'Replacement'});
    fireEvent.change(screen.getByLabelText('Coverage replacement gatekeeper'),{target:{value:'8'}});
    fireEvent.click(screen.getByRole('button',{name:'Assign'}));
    expect(screen.getByRole('button',{name:'Yes Reassign Shift'})).toBeTruthy();
    expect(screen.queryByText('TEMP covers this shift only.')).toBeNull();
    expect(state.request.mock.calls.every(c=>!c[1]?.method)).toBe(true);
  });
  it('only removes the gatekeeper notice after acknowledgment succeeds',async()=>{
    let acknowledged=false;
    state.request.mockImplementation(async (_path,options)=>{
      if(options?.method){acknowledged=true;return {id:12};}
      return {notices:acknowledged?[]:[{id:12,title:'Main Gate Night',startsAt:shift.startsAt,timezone:shift.timezone}],readOnly:false};
    });
    mount(<CoverageAcknowledgments owner={{type:'vendor',id:5}} userId={7}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Acknowledge Shift'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Acknowledge Shift'})).toBeNull());
    const writes=state.request.mock.calls.filter(c=>c[1]?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/site-shift-plans/acknowledge-coverage');
    expect(JSON.parse(writes[0][1].body)).toEqual({notificationId:12});
  });
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
  function setup(readOnly = true, empty = false) {
    state.request.mockImplementation(async (path, options) => {
      if (options?.method) return { resource: { id: "saved" } };
      if (path.includes("coverage-candidates")) return {people:[{id:8,name:"Replacement",pickupExtraShifts:true},{id:9,name:"Other",pickupExtraShifts:false}],truncated:false};
      if (path.includes("coverage-facts"))
        return {
          ...facts,
          readOnly,
          requests: empty ? [] : [{ id: "request", shiftId: "one", userId: 7, status:"approved" }],
        };
      if (path.includes("/schedule"))
        return {
          shifts: [empty ? {...shift, assignees: []} : shift],
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
  it("assigns an empty shift directly with one mocked save and no review step", async () => {
    setup(false, true);
    const category = await screen.findByRole("button", {name:/New \/ Unassigned Recurring Shifts/});
    await waitFor(()=>expect(category.textContent).toContain("1 total"));
    fireEvent.click(category);
    fireEvent.click(await screen.findByRole("button", {name:/Main Gate Day/}));
    const assign = screen.getByRole("button", {name:"Assign"}) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    expect(screen.queryByText("Coverage Resolution")).toBeNull();
    expect(screen.getByRole("region",{name:/Assign coverage for/})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"TEMP"}));
    await screen.findByRole("option", {name:"Replacement"});
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {target:{value:"8"}});
    expect(screen.queryByText("Review coverage")).toBeNull();
    expect(state.request.mock.calls.every(c=>!c[1]?.method)).toBe(true);
    fireEvent.click(assign);
    await waitFor(()=>expect(state.request.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1));
    const body = JSON.parse(state.request.mock.calls.find(c=>c[1]?.method==='POST')![1].body);
    expect(body.payload).toMatchObject({shiftId:"one",originalUserId:null,replacementUserId:8});
  });
  it("shows inline controls with green names and prevents read-only saves", async () => {
    setup();
    const category = await screen.findByRole("button", {name:/Shift requested off/});
    await waitFor(()=>expect(category.textContent).toContain("1 total"));
    expect(category.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Coverage category")).toBeNull();
    expect(screen.queryByRole("button", {name:/Main Gate Day/})).toBeNull();
    fireEvent.click(category);
    expect(category.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Main Gate Day/,
      }),
    );
    expect(screen.queryByLabelText("Site location")).toBeNull();
    const priority = await screen.findByRole("option", {name:"Replacement"});
    expect(priority.className).toContain("hub-pickup-priority");
    expect(screen.queryByRole("option", {name:"Original"})).toBeNull();
    expect(screen.getAllByRole("option").slice(-2).map(o=>o.textContent)).toEqual(["Replacement","Other"]);
    await screen.findByRole("option", {name:"Replacement"});
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByText("Assign"));
    expect(state.request.mock.calls.every(c=>!c[1]?.method)).toBe(true);
    expect(
      (screen.getByText("Assign") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
  });
  it("sends only the reviewed replacement, scope and existing request in a mocked save", async () => {
    setup(false);
    fireEvent.click(await screen.findByRole("button", {name:/Shift requested off/}));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Main Gate Day/,
      }),
    );
    await screen.findByRole("option", {name:"Replacement"});
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", {name:"PERM"}));
    await screen.findByRole("option", {name:"Replacement"});
    fireEvent.change(screen.getByLabelText("Coverage replacement gatekeeper"), {target:{value:"8"}});
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
    fireEvent.click(screen.getByText("Assign"));
    expect(state.request.mock.calls.every(c=>!c[1]?.method)).toBe(true);
    fireEvent.click(screen.getByText("Yes Reassign Shift"));
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
      shifts: [{ ...shift, title:"Main Gate Day", siteName: "Coyote Ridge", requested: false }],
      readOnly: false,
    });
    mount(
      <RequestShiftCoverage
        owner={{ type: "vendor", id: 5 }}
        day="2099-10-25"
      />,
    );
    fireEvent.click(await screen.findByText("Main Gate Day"));
    fireEvent.click(screen.getByText("Request shift off"));
    expect(state.request.mock.calls.every((c) => !c[1]?.method)).toBe(true);
    fireEvent.click(screen.getByText("Submit request"));
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
