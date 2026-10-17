import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  overviewPage: vi.fn(),
  run: vi.fn(),
  gateObservations: vi.fn(),
  reviewPacket: vi.fn(),
  location: "/fleet/my-day",
  resources: vi.fn(),
  action: vi.fn(),
  create: vi.fn(),
  billingOptions: vi.fn(),
  billingTicket: vi.fn(),
  details: vi.fn(),
  rigPackages: vi.fn(),
  commercial: vi.fn(),
  runOrders: vi.fn(),
  runOrder: vi.fn(),
  navigate: vi.fn(),
  complianceRegister:vi.fn(),
  complianceConfiguration:vi.fn(),
  work: {session:null as any,status:{pending:0,needsReconciliation:0,pendingEvidence:0,locked:false},commands:[],error:"",refresh:vi.fn()},
}));
vi.mock("@/hooks/use-fleet-work",()=>({useFleetWork:()=>api.work}));
vi.mock("@/lib/fleet-client", () => ({
  fleetClient: api,
  FleetRequestError: class extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
  fleetErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 7, vendorId: 1, activeMembershipId: 2 } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [api.location, api.navigate],
  Link: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/mapbox-map", () => ({
  MapboxMap: () => <div>Recorded map</div>,
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
import FleetPage from "./fleet";
import { FleetRequestError } from "@/lib/fleet-client";
const run = {
  id: "run1",
  companyId: 1,
  fleetId: "fleet1",
  title: "Own pickup",
  driverUserId: 7,
  vehicleAssetId: "asset1",
  siteIds: [10],
  status: "dispatched",
  version: 2,
  stops: [{ id: "stop", siteId: 10, kind: "pickup", sequence: 0 }],
  loads: [],
  records: [],
  currentStopId: null,
  visitedStopIds: [],
  inspections: [],
  events: [],
  allowedActions: ["acknowledge"],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.work.session=null;
  api.complianceConfiguration.mockResolvedValue({version:1,isReviewer:false,mayAppointReviewers:false,reviewerUserIds:[]});
  window.history.replaceState({}, "", "/");
  api.location = "/fleet/my-day";
  api.billingOptions.mockResolvedValue({
    workTypes: [{ id: 3, name: "Hauling service", rateCents: 10000 }],
    tickets: [],
    afeRequired: false,
    siteAfe: "",
  });
  api.overviewPage.mockResolvedValue({
    companyId: 1,
    enabled: true,
    roles: ["driver"],
    capabilities: { canDrive: true, canDispatch: false, canManage: false },
    fleets: [{ id: "fleet1", name: "Fleet one", siteIds: [10] }],
    runs: [
      run,
      { ...run, id: "other", title: "Other driver", driverUserId: 8 },
    ],
    observations: [],
    unavailableIntegrations: ["hardware_positions"],
    generatedAt: "2026-10-07T00:00:00Z",
  });
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetPage />
    </QueryClientProvider>,
  );
describe("Fleet driver workspace", () => {
  it("retains a modern driver action through the durable journal without claiming server acceptance",async()=>{
    const initial=await api.overviewPage();
    api.overviewPage.mockResolvedValue({...initial,runs:[{...run,ticketReference:{id:500,version:1}}]});
    const captureAction=vi.fn().mockResolvedValue({canonicalApplied:false,state:"outcome_unknown"});api.work.session={captureAction};
    mount();fireEvent.click(await screen.findByText("Own pickup"));fireEvent.click(screen.getByText("Acknowledge assignment"));fireEvent.click(screen.getByText("Save exact change"));
    await waitFor(()=>expect(captureAction).toHaveBeenCalledOnce());
    expect(captureAction.mock.calls[0][1]).toMatchObject({expectedVersion:2,action:"acknowledge"});
    expect(api.action).not.toHaveBeenCalled();expect(await screen.findByText(/Saved on this device.*pending sync/)).toBeTruthy();
  });
  it("opens the compliance register without depending on dispatch resource loading",async()=>{
    api.location="/fleet/compliance";api.complianceRegister.mockResolvedValue({entries:[],mode:"warn_only",nextCursor:null});
    mount();expect(await screen.findByRole("heading",{name:"Compliance"})).toBeTruthy();expect(await screen.findByText(/No evidence recorded/)).toBeTruthy();expect(api.overviewPage).not.toHaveBeenCalled();expect(api.resources).not.toHaveBeenCalled();
  });
  it("prepares saved Runs before customer dispatch is enabled",async()=>{
    const initial=await api.overviewPage(),group="99999999-9999-4999-8999-999999999999";api.location="/fleet/runs";api.overviewPage.mockResolvedValue({...initial,capabilities:{canDrive:false,canDispatch:false,canManage:false,canManageResources:true},fleets:[{id:group,name:"Company resources",siteIds:[],equipmentAssetIds:[]}],runs:[]});api.resources.mockResolvedValue({drivers:[],equipment:[]});api.commercial.mockResolvedValue({version:1,defaultMode:"batch",destinations:[],canManage:true,sites:[],sitePolicy:null});api.runOrders.mockResolvedValue({orders:[],nextCursor:null,canManage:true});
    mount();expect(await screen.findByRole("heading",{name:"Saved Runs"})).toBeTruthy();await waitFor(()=>expect((screen.getByRole("button",{name:"New saved Run"}) as HTMLButtonElement).disabled).toBe(false));expect(screen.queryByRole("button",{name:"Create run"})).toBeNull();
  });
  it("matches a saved transport Run to a Detail and a new billing ticket on Fleet Dispatch",async()=>{
    const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,group=id(1),truck=id(2),detailId=id(3);
    const place=(n:number)=>({id:id(n),revision:1,name:`Place ${n}`,address:`${n} Manual street`,kind:"pickup",latitude:null,longitude:null,ownerType:"vendor",ownerId:1,active:true,materials:[],hours:"",instructions:""});
    const order={id:id(4),companyId:1,version:2,name:"Crude to terminal",accessGroupIds:[group],origin:place(5),destination:place(6),base:null,returnPolicy:"delivery_only",instructions:"Unload crude",timeZone:"America/Chicago",archivedAt:null};
    const initial=await api.overviewPage();api.location="/fleet";
    api.overviewPage.mockResolvedValue({...initial,capabilities:{canDispatch:true,canManage:true},fleets:[{id:group,name:"Company access",siteIds:[10],equipmentAssetIds:[truck]}],runs:[],preference:{selectedFleetId:group}});
    api.resources.mockResolvedValue({drivers:[{userId:7,name:"Bob Villa",fleetIds:[group]}],equipment:[{id:truck,name:"Truck 12",category:"truck",status:"available",dispatchable:true}]});
    api.details.mockResolvedValue({details:[{id:detailId,companyId:1,version:1,name:"Bob with Truck 12",vehicleAssetId:truck,driverUserId:7,rigPackageId:null,rigPackageVersion:null,accessGroupIds:[group],effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:null,archivedAt:null}],nextCursor:null,canManage:true});
    api.rigPackages.mockResolvedValue({rigPackages:[],nextCursor:null});api.runOrders.mockResolvedValue({orders:[order],nextCursor:null,canManage:true});api.runOrder.mockResolvedValue(order);api.commercial.mockResolvedValue({destinations:[order.origin,order.destination]});
    api.create.mockImplementation(async body=>{const saved={id:id(7),linkedTicketId:500,events:[{operationId:body.operationId}]};api.run.mockResolvedValue(saved);return saved;});
    mount();fireEvent.click(await screen.findByRole("button",{name:"Create run"}));
    fireEvent.change(screen.getByLabelText("Run title"),{target:{value:"First crude activity"}});fireEvent.change(await screen.findByLabelText("Saved Detail"),{target:{value:detailId}});
    fireEvent.click(screen.getByRole("button",{name:"Use saved Run"}));await screen.findByRole("option",{name:/Crude to terminal/});fireEvent.change(screen.getByLabelText("Saved Run"),{target:{value:order.id}});
    await waitFor(()=>expect(api.runOrder).toHaveBeenCalledWith(order.id));fireEvent.change(screen.getByLabelText("Billing site"),{target:{value:"10"}});
    fireEvent.change(await screen.findByLabelText("Billing service"),{target:{value:"3"}});fireEvent.click(screen.getByRole("button",{name:"Save exact change"}));
    await waitFor(()=>expect(api.create).toHaveBeenCalled());expect(api.create.mock.calls[0][0]).toMatchObject({runOrderSelection:{id:order.id,version:2},detailSelection:{detailId,detailVersion:1},driverUserId:7,billing:{mode:"new_ticket",workTypeId:3},stops:[{siteId:10,destination:{id:order.origin.id}},{siteId:10,destination:{id:order.destination.id}}]});
  });
  it("offers physical origin/destination dropdowns separately from ticket billing", async () => {
    const initial = await api.overviewPage();
    api.location = "/fleet";
    api.overviewPage.mockResolvedValue({
      ...initial,
      capabilities: { canDispatch: true, canManage: true },
    });
    api.resources.mockResolvedValue({ drivers: [], equipment: [] });
    api.details.mockResolvedValue({
      details: [],
      canManage: true,
      nextCursor: null,
    });
    api.rigPackages.mockResolvedValue({ rigPackages: [], nextCursor: null });
    api.commercial.mockResolvedValue({
      destinations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          revision: 1,
          name: "Terminal",
          address: "Crude road",
          latitude: null,
          longitude: null,
          ownerType: "vendor",
          ownerId: 1,
          kind: "delivery",
          materials: [],
          hours: "",
          instructions: "",
          active: true,
        },
      ],
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Create run" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use Origins and Destinations" }),
    );
    expect(await screen.findByLabelText("Origin")).toBeTruthy();
    expect(screen.getByLabelText("Destination")).toBeTruthy();
    expect(screen.queryByLabelText("Delivery site")).toBeNull();
  });
  it("provides dispatch resources and run controls on Fleet Dispatch", async () => {
    const initial = await api.overviewPage();
    api.location = "/fleet";
    api.overviewPage.mockResolvedValue({
      ...initial,
      capabilities: { canDrive: false, canDispatch: true, canManage: true },
      runs: [
        run,
        {
          ...run,
          id: "working",
          title: "Working delivery",
          status: "in_progress",
        },
      ],
    });
    api.resources.mockResolvedValue({
      drivers: [{ userId: 7, name: "Driver seven", fleetIds: ["fleet1"] }],
      equipment: [
        {
          id: "asset1",
          name: "Truck seven",
          category: "truck",
          status: "active",
          dispatchable: true,
        },
      ],
    });
    mount();
    await screen.findByRole("heading", { name: "Dispatch resources" });
    expect(
      screen.getByRole("heading", { name: "Fleet Dispatch", level: 1 }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Dispatch$/ })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /Awaiting dispatch/ })
        .getAttribute("href"),
    ).toBe("/fleet");
    expect(screen.getByText(/Driver seven/)).toBeTruthy();
    expect(screen.getByText(/Truck seven/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create run" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Working 1" }));
    expect(screen.getByText("Working delivery")).toBeTruthy();
    expect(screen.queryByText("Own pickup")).toBeNull();
  });
  it("replaces the retired Dispatch route with Fleet Dispatch", async () => {
    api.location = "/fleet/dispatch";
    mount();
    await waitFor(() =>
      expect(api.navigate).toHaveBeenCalledWith("/fleet", { replace: true }),
    );
    expect(api.overviewPage).not.toHaveBeenCalled();
  });
  it.each(["/fleet", "/fleet/runs"])(
    "filters the run board and opens run actions on %s",
    async (path) => {
      const initial = await api.overviewPage();
      api.overviewPage.mockResolvedValue({
        ...initial,
        runs: [
          run,
          {
            ...run,
            id: "working",
            title: "Working delivery",
            status: "in_progress",
          },
        ],
      });
      api.location = path;
      mount();
      await screen.findByText("Own pickup");
      fireEvent.click(screen.getByRole("button", { name: "Working 1" }));
      expect(screen.queryByText("Own pickup")).toBeNull();
      expect(screen.getByText("Working delivery")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Working 1" }));
      expect(screen.getByText("Own pickup")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Own pickup/ }));
      expect(await screen.findByText("Acknowledge assignment")).toBeTruthy();
    },
  );
  it("opens Runs without the map or replay clutter", async () => {
    api.location = "/fleet/runs";
    mount();
    await screen.findByText("Own pickup");
    expect(
      screen.queryByRole("heading", { name: "History & Replay" }),
    ).toBeNull();
    expect(screen.queryByText(/No authorized recorded positions/)).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Runs" }),
    ).toBeTruthy();
    const backButton = screen.getByRole("button", { name: /^Back$/ });
    expect(
      backButton.querySelector('[data-testid="sphere-back-circle"]'),
    ).toBeTruthy();
    fireEvent.click(backButton);
    expect(api.navigate).toHaveBeenCalledWith("/fleet", { replace: true });
  });
  it("updates operational review filtering when navigating without remounting", async () => {
    const initial = await api.overviewPage();
    api.overviewPage.mockResolvedValue({
      ...initial,
      runs: [
        run,
        {
          ...run,
          id: "review",
          title: "Review delivery",
          status: "submitted_for_review",
        },
      ],
    });
    api.location = "/fleet/runs";
    const view = mount();
    await screen.findByText("Own pickup");
    api.location = "/fleet/review";
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FleetPage />
      </QueryClientProvider>,
    );
    await screen.findByText("Review delivery");
    expect(screen.queryByText("Own pickup")).toBeNull();
  });
  it("shows only own completed or cancelled loaded runs in recorded history", async () => {
    api.location = "/fleet/history";
    const initial = await api.overviewPage();
    api.overviewPage.mockResolvedValue({
      ...initial,
      runs: [
        run,
        { ...run, id: "done", title: "Own completed", status: "completed" },
        {
          ...run,
          id: "other-done",
          title: "Other completed",
          driverUserId: 8,
          status: "completed",
        },
      ],
    });
    mount();
    await screen.findByText("Own completed");
    expect(screen.queryByText("Own pickup")).toBeNull();
    expect(screen.queryByText("Other completed")).toBeNull();
  });
  it("clears previously loaded runs when a later page reports their fleet grant revoked", async () => {
    const initial = await api.overviewPage();
    api.overviewPage
      .mockResolvedValueOnce({
        ...initial,
        page: { limit: 1, nextCursor: "next" },
      })
      .mockResolvedValueOnce({
        ...initial,
        fleets: [],
        runs: [],
        page: { limit: 1, nextCursor: null },
      });
    mount();
    await screen.findByText("Own pickup");
    fireEvent.click(screen.getByText("Load more authorized runs"));
    await screen.findByText("No runs are currently assigned to you.");
    expect(screen.queryByText("Own pickup")).toBeNull();
  });
  it("loads a current authorized run detail even beyond the overview page", async () => {
    api.location = "/fleet/runs/historical";
    api.run.mockResolvedValueOnce({
      ...run,
      id: "historical",
      title: "Historical pickup",
    });
    mount();
    await screen.findAllByText("Historical pickup");
    expect(api.run).toHaveBeenCalledWith("historical");
    expect(screen.getByText("Acknowledge assignment")).toBeTruthy();
    const backButton = screen.getByRole("button", { name: /^Back$/ });
    expect(
      backButton.querySelector('[data-testid="sphere-back-circle"]'),
    ).toBeTruthy();
    fireEvent.click(backButton);
    expect(api.navigate).toHaveBeenCalledWith("/fleet/runs", { replace: true });
  });
  it("uses real browser back for a run opened from another VNDRLY page", async () => {
    api.location = "/fleet/runs/historical";
    api.run.mockResolvedValue({
      ...run,
      id: "historical",
      title: "Historical pickup",
    });
    window.history.replaceState(
      { __vndrlyNavigationIndex: 1 },
      "",
      "/fleet/runs/historical",
    );
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    try {
      mount();
      fireEvent.click(await screen.findByRole("button", { name: /^Back$/ }));
      expect(back).toHaveBeenCalledOnce();
      expect(api.navigate).not.toHaveBeenCalled();
    } finally {
      back.mockRestore();
    }
  });
  it("loads the server cursor without losing already loaded authorized runs", async () => {
    const initial = await api.overviewPage();
    api.overviewPage
      .mockResolvedValueOnce({
        ...initial,
        runs: [run],
        page: { limit: 1, nextCursor: "next-authorized-page" },
      })
      .mockResolvedValueOnce({
        ...initial,
        runs: [{ ...run, id: "run2", title: "Second pickup" }],
        page: { limit: 1, nextCursor: null },
      });
    mount();
    fireEvent.click(await screen.findByText("Load more authorized runs"));
    await screen.findByText("Second pickup");
    expect(api.overviewPage).toHaveBeenCalledWith("next-authorized-page");
    expect(screen.getByText("Own pickup")).toBeTruthy();
  });
  it.each(["response", "readback"])(
    "keeps generated run and stop identities after a lost %s",
    async (failure) => {
      const fleetId = "22222222-2222-4222-8222-222222222222";
      const assetId = "33333333-3333-4333-8333-333333333333";
      api.overviewPage.mockResolvedValueOnce({
        companyId: 1,
        enabled: true,
        capabilities: { canDrive: true, canDispatch: true, canManage: true },
        fleets: [
          {
            id: fleetId,
            name: "North fleet",
            siteIds: [10, 20],
            equipmentAssetIds: [assetId],
          },
        ],
        runs: [],
        observations: [],
        unavailableIntegrations: [],
        generatedAt: "now",
      });
      api.resources.mockResolvedValueOnce({
        drivers: [{ userId: 7, name: "Driver seven", fleetIds: [fleetId] }],
        equipment: [
          {
            id: assetId,
            name: "Truck seven",
            category: "truck",
            dispatchable: true,
          },
        ],
      });
      if (failure === "response")
        api.create.mockRejectedValueOnce(new Error("connection lost"));
      else
        api.create.mockImplementationOnce(async () => {
          api.run.mockRejectedValueOnce(
            new FleetRequestError("fleet.not_found", 404),
          );
          return { id: "new-run" };
        });
      api.create.mockImplementationOnce(async (input) => {
        api.run.mockResolvedValue({
          ...run,
          id: "new-run",
          linkedTicketId: 123,
          events: [{ operationId: input.operationId }],
        });
        return { id: "new-run" };
      });
      mount();
      fireEvent.click(await screen.findByText("Create run"));
      fireEvent.change(screen.getByLabelText("Resource pool"), {
        target: { value: fleetId },
      });
      await screen.findByText("Driver seven");
      fireEvent.change(screen.getByLabelText("Run title"), {
        target: { value: "Water delivery" },
      });
      fireEvent.change(screen.getByLabelText("Driver"), {
        target: { value: "7" },
      });
      fireEvent.change(screen.getByLabelText("Vehicle"), {
        target: { value: assetId },
      });
      fireEvent.change(screen.getByLabelText("Pickup site"), {
        target: { value: "10" },
      });
      fireEvent.change(screen.getByLabelText("Delivery site"), {
        target: { value: "20" },
      });
      await screen.findByRole("option", { name: /Hauling service/ });
      fireEvent.change(screen.getByLabelText("Billing service"), {
        target: { value: "3" },
      });
      await waitFor(() =>
        expect(
          (screen.getByText("Save exact change") as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByText("Save exact change"));
      await screen.findByText(/record changed or this action is blocked/);
      expect(
        (
          screen
            .getByLabelText("Run title")
            .closest("fieldset") as HTMLFieldSetElement
        ).disabled,
      ).toBe(true);
      fireEvent.click(screen.getByText("Retry exact run save"));
      await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
      expect(api.create.mock.calls[0][0]).toEqual(api.create.mock.calls[1][0]);
      expect(api.create.mock.calls[0][0].billing).toMatchObject({
        mode: "new_ticket",
        workTypeId: 3,
      });
      await screen.findByText(/Linked ticket #123/);
    },
  );
  it("shows only assigned runs without adding a map or dispatch creation to the operations page", async () => {
    mount();
    await screen.findByText("Own pickup");
    expect(screen.queryByText("Other driver")).toBeNull();
    expect(screen.queryByText("Create run")).toBeNull();
    expect(screen.getByText(/No authorized recorded positions/)).toBeTruthy();
    expect(api.resources).not.toHaveBeenCalled();
  });
  it("requires exact review, keeps retry identity after an uncertain response, and sends server version", async () => {
    api.action
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ ...run, version: 3 });
    mount();
    fireEvent.click(await screen.findByText("Own pickup"));
    fireEvent.click(screen.getByText("Acknowledge assignment"));
    expect(api.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save exact change"));
    await screen.findByText(/record changed or this action is blocked/);
    fireEvent.click(screen.getByText("Save exact change"));
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2));
    expect(api.action.mock.calls[0]).toEqual(api.action.mock.calls[1]);
    expect(api.action.mock.calls[0][1]).toMatchObject({
      expectedVersion: 2,
      action: "acknowledge",
    });
  });
  it("does not advertise blocked or absent run actions", async () => {
    api.overviewPage.mockResolvedValueOnce({
      companyId: 1,
      enabled: true,
      capabilities: { canDrive: true },
      fleets: [{ id: "fleet1", name: "Fleet one", siteIds: [10] }],
      runs: [{ ...run, allowedActions: [] }],
      observations: [],
      unavailableIntegrations: [],
      generatedAt: "now",
    });
    mount();
    fireEvent.click(await screen.findByText("Own pickup"));
    expect(screen.queryByText("Acknowledge assignment")).toBeNull();
    expect(api.action).not.toHaveBeenCalled();
  });
});

it("blocks closeout review until current required saved files are present", async () => {
  api.location = "/fleet/runs/run1";
  api.run.mockResolvedValue({
    ...run,
    status: "in_progress",
    allowedActions: ["submit_closeout"],
  });
  api.reviewPacket.mockResolvedValue({
    runId: run.id,
    runVersion: run.version,
    missingRequiredCount: 1,
    inspectionExceptions: 0,
    undeliveredLoadCount: 0,
    requirements: [],
  });
  mount();
  const button = await screen.findByRole("button", { name: "Close Run" });
  fireEvent.click(button);
  await screen.findAllByText(
    "Recorded requirements are incomplete. Save missing files and complete the inspection, manifests and closeout records before review.",
  );
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.queryByText(/Review change submit_closeout/)).toBeNull();
});
