import {saveWebFleetWorkspace,readWebFleetWorkspace,activateWebFleetOffline} from "@/lib/fleet-offline-bootstrap";
import {provisionFleetOfflineShell} from "@/lib/fleet-offline-shell";
import {FleetRetainedEvidence} from "@/components/fleet-retained-evidence";
import {FleetCommercialWork} from "@/components/fleet-commercial-work";
import { FleetRouteReplay } from "@/components/fleet-route-replay";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useFleetWork } from "@/hooks/use-fleet-work";
import { FleetOperationsMap } from "@/components/fleet-operations-map";
import { FleetInventoryPage } from "@/components/fleet-inventory";
import { FleetDestinationsPage } from "@/components/fleet-destinations";
import { FleetRouteFields } from "@/components/fleet-route-fields";
import { FleetRunOrderChoice } from "@/components/fleet-run-order-choice";
import { FleetSaveRunOrder } from "@/components/fleet-save-run-order";
import { FleetRunOrders } from "@/components/fleet-run-orders";
import {FleetComplianceRegister} from "@/components/fleet-compliance-register";
import {
  FleetRunBillingFields,
  FleetBillingTicketPanel,
  type FleetBillingDraft,
} from "@/components/fleet-billing";
import ImagePill from "@/components/image-pill";
import "./fleet.css";
import { PngPillButton } from "@/components/png-pill-rollover";
import PageBackButton from "@/components/page-back-button";
import {
  fleetClient,
  fleetErrorMessage,
  FleetRequestError,
} from "@/lib/fleet-client";
import {
  FleetActionFields,
  fleetActionComplete,
} from "@/components/fleet-action-fields";
import { fleetCopy } from "@/lib/fleet-copy";
import { FleetSupportPanel } from "@/components/fleet-support";
import { FleetManagementProjections } from "@/components/fleet-management-projections";
import { FleetSiteActivityPanel } from "@/components/fleet-site-activity";
import { FleetSetupPanel } from "@/components/fleet-setup";
import { FleetPreferences } from "@/components/fleet-preferences";
import { FleetMaintenancePanel } from "@/components/fleet-maintenance";
import { FleetReportsPanel } from "@/components/fleet-reports";
import {
  FleetScheduleFields,
  fleetScheduleDraft,
  parseFleetSchedule,
} from "@/components/fleet-schedule-fields";
import { FleetDraftEditor } from "@/components/fleet-draft-editor";
import { FleetDriverAvailability } from "@/components/fleet-driver-availability";
import { FleetReplacementPanel } from "@/components/fleet-replacement";
import { FleetCargoPanel } from "@/components/fleet-cargo";
import { FleetReviewPacketPanel } from "@/components/fleet-review-packet";
import { FleetEvidencePanel } from "@/components/fleet-evidence";
import { FleetEtaPanel } from "@/components/fleet-eta";
import { FleetGateObservationsPanel } from "@/components/fleet-gate-observations";
import { fleetPositions, fleetVisibleRuns } from "@/lib/fleet-view";
import {
  CreateFleetRunSchema,
  previewFleetWorkEntries,
  fleetRouteOperationalStops,
  fleetRunOrderRoute,
  type FleetRunOrder,
  type FleetRoutePlan,
  type FleetActionInput,
} from "@workspace/api-zod";
import type { z } from "zod/v4";

export default function FleetPage() {
  const { user } = useAuth();
  const {i18n}=useTranslation();
  const [location, navigate] = useLocation();
  useEffect(() => {
    if (user && location === "/fleet/dispatch")
      navigate("/fleet", { replace: true });
  }, [user, location, navigate]);
  if (!user || location === "/fleet/dispatch") return null;
  if(location==="/fleet/compliance")return <main className="fleet-workspace space-y-4 p-4 md:p-6"><header className="flex items-center gap-3"><PageBackButton fallbackHref="/fleet"/><h1 className="text-2xl font-semibold">{fleetCopy(i18n.language).compliance}</h1></header><FleetComplianceRegister companyId={user.vendorId??undefined} key={`${user.userId}:${user.activeMembershipId}:${user.vendorId}`} identity={`${user.userId}:${user.activeMembershipId}:${user.vendorId}`}/></main>;
  if (location === "/fleet/destinations")
    return (
      <FleetDestinationsPage
        key={`${user.userId}:${user.activeMembershipId}:${user.vendorId}`}
        identity={`${user.userId}:${user.activeMembershipId}:${user.vendorId}`}
      />
    );
  if (
    location === "/fleet/equipment" ||
    location.startsWith("/fleet/equipment/")
  ) {
    const identity = `${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`;
    return (
      <FleetInventoryPage
        key={identity}
        identity={identity}
        assetId={location.split("/")[3]}
      />
    );
  }
  if (location === "/fleet/support")
    return (
      <FleetSupportPanel
        key={`${user.userId}:${user.activeMembershipId}`}
        identity={`${user.userId}:${user.activeMembershipId}`}
      />
    );
  if (location === "/fleet/site-activity")
    return (
      <FleetSiteActivityPanel
        key={`${user.userId}:${user.activeMembershipId}:${user.partnerId}`}
        identity={`${user.userId}:${user.activeMembershipId}:${user.partnerId}`}
      />
    );
  return (
    <FleetWorkspace
      key={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`}
      userId={user.userId}
      identity={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`}
    />
  );
}
function FleetWorkspace({
  userId,
  identity,
}: {
  userId: number;
  identity: string;
}) {
  const {user:workspaceUser}=useAuth();
  const cachedSources=useRef(new Map<string,string>());
  const currentIdentity=useRef(identity);currentIdentity.current=identity;
  const [offlineAt,setOfflineAt]=useState<string|null>(null),[offlineProvision,setOfflineProvision]=useState("");
  useEffect(()=>()=>{currentIdentity.current="";},[identity]);
  async function cachedRead<T>(fresh:()=>Promise<T>,select:(value:NonNullable<Awaited<ReturnType<typeof readWebFleetWorkspace>>>)=>T,source:string):Promise<T>{
    try{const value=await fresh();if(currentIdentity.current===identity){cachedSources.current.delete(source);setOfflineAt([...cachedSources.current.values()].sort()[0]??null);}return value;}catch(error){
      const status=Number((error as {status?:number})?.status);
      if(!workspaceUser||(Number.isFinite(status)&&status<500)||(!(error instanceof TypeError)&&navigator.onLine!==false&&!(status>=500)))throw error;
      const retained=await readWebFleetWorkspace(workspaceUser,()=>currentIdentity.current===identity).catch(()=>null);if(!retained||currentIdentity.current!==identity)throw error;cachedSources.current.set(source,retained.receivedAt);setOfflineAt([...cachedSources.current.values()].sort()[0]??null);return select(retained);
    }
  }
  const { i18n, t } = useTranslation();
  const describeFleetError = (error: unknown, fallback: string) => {
    const code = (error as { code?: string })?.code;
    return code === "fleet.driver_availability_unknown"
      ? t("fleetAvailability.unknown_no_window")
      : code === "fleet.driver_schedule_conflict"
        ? t("fleetAvailability.recorded_conflict")
        : fleetErrorMessage(error, fallback);
  };
  const c = fleetCopy(i18n.language);
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const section = location.split("/")[2] || "desk";
  const routeRunId = location.startsWith("/fleet/runs/")
    ? location.split("/")[3]
    : "";
  const routeRun = useQuery({
    queryKey: ["fleet", identity, "run", routeRunId],
    queryFn: () => cachedRead(()=>fleetClient.run(routeRunId),saved=>{const run=saved.overview.runs.find(item=>item.id===routeRunId);if(!run)throw Error("This activity was not downloaded to this device");return run;},"run"),
    enabled: Boolean(routeRunId),
    retry: false,
  });
  const overview = useInfiniteQuery({
    queryKey: ["fleet", identity, "pages"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => cachedRead(()=>fleetClient.overviewPage(pageParam),saved=>{if(pageParam)throw Error("Connect to load additional Fleet pages");return {...saved.overview,observations:saved.overview.observations.map(value=>({...value,freshness:"stale" as const}))};},"overview"),
    getNextPageParam: (page) => page.page?.nextCursor ?? undefined,
    retry: false,
  });
  const latestPage = overview.data?.pages.at(-1);
  const overviewData = latestPage && {
    ...latestPage,
    runs: [
      ...new Map(
        overview
          .data!.pages.flatMap((page) => page.runs)
          .filter((run) => !(routeRun.isError && run.id === routeRunId))
          .concat(routeRun.data && !routeRun.isError ? [routeRun.data] : [])
          .filter((run) =>
            latestPage.fleets.some(
              (fleet) =>
                fleet.id === run.fleetId &&
                run.siteIds.every((siteId) => fleet.siteIds.includes(siteId)),
            ),
          )
          .map((run) => [run.id, run]),
      ).values(),
    ],
    observations: overview.data!.pages.flatMap((page) => page.observations),
  };
  const work = useFleetWork(overviewData?.accountScope, overviewData?.runs ?? []);
  const resources = useQuery({
    queryKey: ["fleet-resources", identity],
    queryFn: ()=>cachedRead(fleetClient.resources,saved=>saved.resources,"resources"),
    enabled: Boolean(overviewData?.capabilities.canDispatch || overviewData?.capabilities.canManageResources),
    retry: false,
  });
  useEffect(()=>{let alive=true;if(work.session&&overviewData?.accountScope&&workspaceUser&&!offlineAt&&(!overviewData.capabilities.canDispatch||resources.data))void saveWebFleetWorkspace(workspaceUser,{overview:overviewData,resources:resources.data??{drivers:[],equipment:[]}},()=>alive&&currentIdentity.current===identity).catch(error=>{if(alive)setOfflineProvision(error instanceof Error?error.message:"Offline workspace cache unavailable");});return()=>{alive=false;};},[work.session,overview.dataUpdatedAt,resources.dataUpdatedAt,routeRun.dataUpdatedAt,identity,offlineAt]);
  async function provisionOffline(){if(!workspaceUser||!work.session||!overviewData||offlineAt)return;setOfflineProvision("Preparing protected Fleet offline reload");try{await saveWebFleetWorkspace(workspaceUser,{overview:overviewData,resources:resources.data??{drivers:[],equipment:[]}},()=>currentIdentity.current===identity);const result=await provisionFleetOfflineShell();if(currentIdentity.current!==identity)return;if(result.status!=="durable_ready"){setOfflineProvision(result.reason);return;}activateWebFleetOffline(workspaceUser);setOfflineProvision("Fleet offline reload provisioned for this original account. Server permissions are rechecked at synchronization.");}catch(error){if(currentIdentity.current===identity)setOfflineProvision(error instanceof Error?error.message:"Offline provision failed");}}
  const createRetry = useRef<{
    fingerprint: string;
    input: z.infer<typeof CreateFleetRunSchema>;
  } | null>(null);
  const [fleetId, setFleetId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(
    location.startsWith("/fleet/runs/") ? location.split("/")[3] : "",
  );
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected)
      detailRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
  }, [selected]);
  useEffect(() => {
    if (routeRunId) setSelected(routeRunId);
  }, [routeRunId]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("");
  const [lane, setLane] = useState("");
  useEffect(() => {
    setStatus("");
    setLane("");
    setSelected(routeRunId);
    setPending(null);
    setCreate(false);
  }, [location]);
  const [pending, setPending] = useState<{
    id: string;
    input: FleetActionInput;
  } | null>(null);
  const [create, setCreate] = useState(false);
  const [physicalMode, setPhysicalMode] = useState(false),
    [physicalRoute, setPhysicalRoute] = useState<FleetRoutePlan | null>(null),
    [selectedDetailId, setSelectedDetailId] = useState("");
  const [useRunOrder,setUseRunOrder]=useState(false),[runOrder,setRunOrder]=useState<FleetRunOrder|null>(null);
  const [orderPending,setOrderPending]=useState(false);
  const detailChoices = useQuery({
    queryKey: ["fleet-details", identity, "composer"],
    queryFn: () => fleetClient.details(),
    enabled: create,
    retry: false,
  });
  const packageChoices = useQuery({
    queryKey: ["fleet-rig-packages", identity, "composer"],
    queryFn: () => fleetClient.rigPackages(),
    enabled: create,
    retry: false,
  });
  const directory = useQuery({
    queryKey: ["fleet-destinations", identity],
    queryFn: () => fleetClient.commercial(),
    enabled: create && physicalMode,
    retry: false,
  });
  const [title, setTitle] = useState("");
  const [billing, setBilling] = useState<FleetBillingDraft>(() => ({
    mode: "new_ticket",
    workTypeId: "",
    ticketId: "",
    afeNumber: "",
    workDate: new Date().toLocaleDateString("en-CA"),
  }));
  const [billingValid, setBillingValid] = useState(false);
  const [createUnverified, setCreateUnverified] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(() =>
    fleetScheduleDraft(null),
  );
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [trailer, setTrailer] = useState("");
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [returnSite, setReturnSite] = useState("");
  const [extraStops, setExtraStops] = useState<
    { kind: "pickup" | "delivery"; siteId: string }[]
  >([]);
  const preferenceApplied = useRef(false);
  useEffect(() => {
    if (!preferenceApplied.current && overviewData) {
      preferenceApplied.current = true;
      const preferred = overviewData.preference?.selectedFleetId;
      if (
        preferred &&
        overviewData.fleets.some((fleet) => fleet.id === preferred)
      )
        setFleetId(preferred);
    }
  }, [overview.data]);
  const [reason, setReason] = useState("");
  if (overview.isPending) return <p className="p-6">{c.loading}</p>;
  if (overview.isError)
    return (
      <div className="p-6">
        <p role="alert">{c.unavailable}</p>
        <PngPillButton onClick={() => void overview.refetch()}>
          {c.refresh}
        </PngPillButton>
      </div>
    );
  const data = overviewData;
  if (
    !data?.enabled ||
    !(
      data.capabilities.canDrive ||
      data.capabilities.canManageResources ||
      data.capabilities.canDispatch ||
      data.capabilities.canManage
    )
  )
    return (
      <div className="p-6">
        <p>{c.denied}</p>
        {data?.capabilities.canSetup && <FleetSetupPanel identity={identity} />}
      </div>
    );
  if (location.endsWith("/setup") && data.capabilities.canSetup)
    return (
      <div className="fleet-workspace space-y-4 p-6">
        <Link href="/fleet">{c.desk}</Link>
        <FleetSetupPanel identity={identity} />
      </div>
    );
  if (location.endsWith("/settings"))
    return (
      <div className="fleet-workspace space-y-4 p-6">
        <Link href="/fleet">{c.desk}</Link>
        <FleetPreferences overview={data} identity={identity} />
      </div>
    );
  if (location.endsWith("/maintenance"))
    return (
      <div className="fleet-workspace space-y-4 p-6">
        <Link href="/fleet">{c.workspace}</Link>
        <FleetMaintenancePanel
          overview={data}
          resources={resources.data}
          identity={identity}
          userId={userId}
        />
      </div>
    );
  if (location.endsWith("/reports"))
    return (
      <div className="fleet-workspace space-y-4 p-6">
        <Link href="/fleet">{c.workspace}</Link>
        <FleetReportsPanel overview={data} identity={identity} />
      </div>
    );
  const mine =
    location.includes("my-day") ||
    (!data.capabilities.canManage && !data.capabilities.canDispatch);
  const filteredRuns = fleetVisibleRuns(
    data,
    userId,
    mine,
    fleetId,
    siteId,
    search,
  ).filter(
    (item) =>
      (!location.endsWith("/history") ||
        ["completed", "cancelled"].includes(item.status)) &&
      (!location.endsWith("/review") ||
        item.status === "submitted_for_review") &&
      (!status || item.status === status),
  );
  const runLane = (status: string) =>
    status === "submitted_for_review"
      ? "review"
      : status === "in_progress"
        ? "working"
        : ["completed", "cancelled"].includes(status)
          ? "finished"
          : "ready";
  const runs = filteredRuns.filter(
    (item) => !lane || runLane(item.status) === lane,
  );
  const run = runs.find((item) => item.id === selected);
  let devicePreview:ReturnType<typeof previewFleetWorkEntries>=null,devicePreviewError="";
  if(run?.ticketReference){try{devicePreview=previewFleetWorkEntries(run,work.entries??[],userId);}catch(error){devicePreviewError=error instanceof Error?error.message:"Original work needs verification";}}
  const actionRun=run&&devicePreview?{...run,version:devicePreview.expectedVersion,currentStopId:devicePreview.currentStopId,allowedActions:devicePreview.allowedActions}:run;
  const formRun=actionRun&&devicePreview?{...actionRun,loads:devicePreview.loads}:actionRun;

  const observations = fleetPositions(
    data,
    new Set(runs.map((item) => item.id)),
  );
  const isDesk = section === "desk";
  const isMap = section === "map" || (mine && section === "my-day");
  const showRunList =
    !routeRunId &&
    ["desk", "runs", "review", "history", "my-day"].includes(section);
  const showDetails = Boolean(run) || isMap;
  const heading =
    (
      {
        desk: c.desk,
        map: c.map,
        runs: c.runs,
        loads: c.loads,
        review: c.review,
        costs: c.costs,
        history: c.history,
        equipment: c.equipment,
        drivers: c.drivers,
        readiness: c.readinessTitle,
        "my-day": c.myDay,
      } as Record<string, string>
    )[section] ?? c.workspace;
  const candidates = resources.data;
  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ["fleet", identity] });
  }
  async function saveAction() {
    if (
      !pending ||
      busy ||
      !run ||
      pending.id !== run.id ||
      !actionRun?.allowedActions.includes(pending.input.action) ||
      !!devicePreviewError ||
      !fleetActionComplete(pending.input, formRun)
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      if (run.ticketReference) {
        if (!work.session) throw new Error("Verify the original Fleet device before recording this activity");
        const result = await work.session.captureAction(run, pending.input, run.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
        await work.refresh(false);
        setPending(null);
        if (!result.canonicalApplied) {
          setNotice(result.state === "needs_reconciliation" || result.state === "denied" ? "Saved on this device — office reconciliation required" : "Saved on this device — pending sync");
          return;
        }
        const saved = await fleetClient.run(run.id);
        if (saved.version <= pending.input.expectedVersion) throw new Error("Saved action needs canonical readback verification");
      } else await fleetClient.action(pending.id, pending.input);
      setPending(null);
      setNotice(c.saved);
      await reload();
    } catch (error) {
      setNotice(describeFleetError(error, c.blocked));
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function saveRun() {
    const retained = createUnverified && createRetry.current;
    if (
      busy ||
      orderPending ||
      !data ||
      (!retained &&
        (!fleetId ||
          !driver ||
          !vehicle ||
          !pickup ||
          (physicalMode ? !physicalRoute : !delivery) ||
          (useRunOrder && (!runOrder || !selectedDetailId)) ||
          (runOrder && !selectedDetailId) ||
          (!physicalMode && extraStops.some((stop) => !stop.siteId)) ||
          !billingValid))
    )
      return;
    const schedule = retained
      ? { valid: true, schedule: retained.input.schedule }
      : parseFleetSchedule(scheduleDraft);
    if (!schedule.valid) {
      setNotice(c.blocked);
      return;
    }
    setBusy(true);
    const fingerprint = JSON.stringify({
      schedule: schedule.schedule,
      fleetId,
      title,
      driver,
      vehicle,
      trailer,
      pickup,
      delivery,
      returnSite,
      extraStops,
      billing,
      physicalMode,
      physicalRoute,
      selectedDetailId,
      runOrder,
    });
    if (!createUnverified && createRetry.current?.fingerprint !== fingerprint)
      createRetry.current = {
        fingerprint,
        input: {
          operationId: crypto.randomUUID(),
          fleetId,
          title,
          billing:
            billing.mode === "new_ticket"
              ? {
                  mode: "new_ticket",
                  workTypeId: Number(billing.workTypeId),
                  afeNumber: billing.afeNumber.trim(),
                  workDate: billing.workDate,
                }
              : {
                  mode: "existing_ticket",
                  ticketId: Number(billing.ticketId),
                  afeNumber: billing.afeNumber.trim(),
                  workDate: billing.workDate,
                },
          schedule: schedule.schedule,
          driverUserId: Number(driver),
          vehicleAssetId: vehicle,
          trailerAssetId: trailer || null,
          stops: [
            {
              id: crypto.randomUUID(),
              siteId: Number(pickup),
              kind: "pickup",
              sequence: 0,
            },
            {
              id: crypto.randomUUID(),
              siteId: Number(delivery),
              kind: "delivery",
              sequence: 1,
            },
            ...extraStops.map((stop, index) => ({
              id: crypto.randomUUID(),
              siteId: Number(stop.siteId),
              kind: stop.kind,
              sequence: index + 2,
            })),
            ...(returnSite
              ? [
                  {
                    id: crypto.randomUUID(),
                    siteId: Number(returnSite),
                    kind: "return" as const,
                    sequence: 2 + extraStops.length,
                  },
                ]
              : []),
          ],
        },
      };
    if (!createUnverified && createRetry.current) {
      const chosen = detailChoices.data?.details.find(
        (item) => item.id === selectedDetailId,
      );
      const input = createRetry.current.input;
      if(runOrder)input.runOrderSelection={id:runOrder.id,version:runOrder.version};
      if (physicalMode && physicalRoute) {
        input.routePlan = {
          ...physicalRoute,
          plannedWindow: schedule.schedule
            ? {
                startAt: schedule.schedule.plannedStartAt,
                endAt: schedule.schedule.plannedEndAt,
                timeZone: schedule.schedule.timezone,
              }
            : null,
        };
        input.stops = fleetRouteOperationalStops(
          input.routePlan,
          Number(pickup),
          input.stops[0].id,
        );
      }
      if (chosen)
        input.detailSelection = {
          version: 2,
          detailId: chosen.id,
          detailVersion: chosen.version,
          timeZone:
            schedule.schedule?.timezone ??
            runOrder?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          returnPolicy:
            input.routePlan?.returnPolicy ??
            (returnSite ? "return_required" : "delivery_only"),
        };
    }
    const creation = createRetry.current;
    if (!creation) {
      setBusy(false);
      return;
    }
    let creationAccepted = false;
    try {
      const input = CreateFleetRunSchema.parse(creation.input);
      let created: {id:string};
      if (work.session) {
        const result = await work.session.captureCreate(input);
        await work.refresh(false);
        if (!result.canonicalApplied) {
          createRetry.current = null; setCreateUnverified(false); setCreate(false);
          setNotice(result.state === "needs_reconciliation" || result.state === "denied" ? "Saved on this device — office reconciliation required" : "Saved on this device — pending sync");
          return;
        }
        creationAccepted = true;
        const reference = (result.receipt?.status === "applied" || result.receipt?.status === "duplicate") ? result.receipt.canonicalReferences.find(ref=>ref.kind === "activity") : undefined;
        if (!reference) throw new Error("Created activity needs canonical readback verification");
        created = {id:String(reference.id)};
      } else created = await fleetClient.create(input);
      creationAccepted = true;
      const saved = await fleetClient.run(created.id);
      if (
        !saved.linkedTicketId ||
        !saved.events.some(
          (event) => event.operationId === creation.input.operationId,
        )
      )
        throw new Error("Run creation needs verification");
      createRetry.current = null;
      setCreateUnverified(false);
      setCreate(false);
      setNotice(`${c.saved} ${c.ticket} #${saved.linkedTicketId}`);
      await reload();
    } catch (error) {
      const rejected =
        !creationAccepted &&
        error instanceof FleetRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status);
      setCreateUnverified(!rejected);
      if (rejected) createRetry.current = null;
      setNotice(describeFleetError(error, c.blocked));
    } finally {
      setBusy(false);
    }
  }
  const selectClass = "rounded border bg-background px-3 py-2 text-sm";
  return (
    <main className="fleet-workspace space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {(routeRunId || section === "runs") && (
            <PageBackButton
              fallbackHref={routeRunId ? "/fleet/runs" : "/fleet"}
              ariaLabel={c.back}
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold">{heading}</h1>
            <p className="text-sm text-muted-foreground">{c.subtitle}</p>
          </div>
        </div>
        <PngPillButton onClick={() => void reload()}>{c.refresh}</PngPillButton>
      </header>
      {(offlineAt||workspaceUser?.offlineOnly)&&<section className="fleet-detail-group"><p>Offline original workspace{offlineAt?` from ${offlineAt}`:""}. Permissions, resources and positions are cached and unverified. Device facts remain pending until canonical acceptance.</p></section>}
      {work.session && <section className="fleet-panel space-y-2" aria-label="Retained Fleet work">
        <p>{work.status.pending} pending sync · {work.status.needsReconciliation} needing office reconciliation · {work.status.pendingEvidence} pending evidence</p>
        <p>Device saves remain pending until accepted by the server. Local references are not billing ticket numbers.</p>
        {!!work.error && <p role="alert">{work.error}</p>}
        <PngPillButton disabled={busy} onClick={()=>void work.refresh()}>Verify and synchronize retained work</PngPillButton>
        <PngPillButton disabled={busy||!!offlineAt} onClick={()=>void provisionOffline()}>Prepare this browser for offline Fleet work</PngPillButton>
        {!!offlineProvision&&<p role="status">{offlineProvision}</p>}
      </section>}
      <nav
        className="fleet-nav flex flex-wrap text-sm"
        aria-label={c.workspace}
      >
        {(data.capabilities.canManage || data.capabilities.canDispatch) && (
          <Link
            href="/fleet"
            aria-current={section === "desk" ? "page" : undefined}
          >
            {c.desk}
          </Link>
        )}
        {data.capabilities.canDrive && (
          <Link href="/fleet/my-day">{c.myDay}</Link>
        )}
        {data.capabilities.canSetup && (
          <Link href="/fleet/setup">{c.setup}</Link>
        )}
        <Link href="/fleet/map">{c.map}</Link>
        <Link href="/fleet/runs">{c.runs}</Link>
        <Link href="/fleet/loads">{c.loads}</Link>
        {(data.capabilities.canManage || data.capabilities.canDispatch) && (
          <Link href="/fleet/review">{c.review}</Link>
        )}
        <Link href="/fleet/equipment">{c.equipment}</Link>
        <Link href="/fleet/destinations">{c.destinations}</Link>
        <Link href="/fleet/compliance">{c.compliance}</Link>
        <Link href="/fleet/drivers">{c.drivers}</Link>
        <Link href="/fleet/readiness">{c.readinessTitle}</Link>
        <Link href="/fleet/costs">{c.costs}</Link>
        {(data.capabilities.canReportDefect ??
          (data.capabilities.canManage || data.capabilities.canDrive)) && (
          <Link href="/fleet/maintenance">{c.maintenance}</Link>
        )}
        <Link href="/work-hub">{c.workHub}</Link>
        <Link href="/fleet/reports">{c.reports}</Link>
        <Link href="/fleet/history">{c.history}</Link>
      </nav>
      <div
        className="fleet-filters flex flex-wrap gap-3"
        role="search"
        aria-label={c.filters}
      >
        <select
          aria-label={c.fleet}
          disabled={orderPending}
          className={selectClass}
          value={fleetId}
          onChange={(event) => {
            setFleetId(event.target.value);
            setRunOrder(null);
            setPhysicalRoute(null);
            setSelectedDetailId("");
            setSiteId("");
            setDriver("");
            setPickup("");
            setDelivery("");
            setReturnSite("");
            setExtraStops([]);
            setSelected("");
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.fleet}
          </option>
          {data.fleets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={c.site}
          className={selectClass}
          value={siteId}
          onChange={(event) => {
            setSiteId(event.target.value);
            setSelected("");
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.site}
          </option>
          {[
            ...new Set(
              data.fleets
                .filter((item) => !fleetId || item.id === fleetId)
                .flatMap((item) => item.siteIds),
            ),
          ].map((id) => (
            <option key={id} value={id}>
              {c.site} {id}
            </option>
          ))}
        </select>
        <select
          aria-label={c.status}
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.status}
          </option>
          {[...new Set(data.runs.map((item) => item.status))].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <input
          className={selectClass}
          aria-label={c.search}
          placeholder={c.search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPending(null);
          }}
        />
        {data.capabilities.canDispatch && (
          <PngPillButton onClick={() => setCreate(!create)}>
            {c.create}
          </PngPillButton>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {!routeRunId&&section==="runs"&&(data.capabilities.canManageResources||data.capabilities.canDispatch)&&<FleetRunOrders key={identity} identity={identity} companyId={data.companyId} groups={data.fleets}/>}
      {!routeRunId && ["desk", "runs"].includes(section) && (
        <div className="fleet-lanes" role="group" aria-label={c.runBoard}>
          {(["ready", "working", "review", "finished"] as const).map(
            (value) => (
              <button
                key={value}
                className="fleet-summary-card"
                aria-label={`${c[value]} ${filteredRuns.filter((item) => runLane(item.status) === value).length}`}
                aria-pressed={lane === value}
                onClick={() => {
                  setLane(lane === value ? "" : value);
                  setSelected("");
                  setPending(null);
                }}
              >
                <span>{c[value]}</span>
                <strong>
                  {
                    filteredRuns.filter(
                      (item) => runLane(item.status) === value,
                    ).length
                  }
                </strong>
              </button>
            ),
          )}
        </div>
      )}
      {["equipment", "drivers", "readiness", "costs"].includes(
        location.split("/")[2],
      ) && (
        <FleetManagementProjections
          section={location.split("/")[2]}
          data={data}
          resources={!resources.isError ? candidates : undefined}
          runs={runs}
          fleetId={fleetId}
          search={search}
        />
      )}
      {location.endsWith("/loads") && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{c.loads}</h2>
          <p className="text-sm text-muted-foreground">
            Saved reports and references from authorized runs. Media, scale
            readings and signatures are available only when recorded by a
            connected source.
          </p>
          {runs.flatMap((item) =>
            item.loads.map((load) => (
              <article className="rounded border p-3" key={load.id}>
                <Link href={`/fleet/runs/${item.id}`}>{item.title}</Link>
                <p>
                  {load.commodity} · {load.quantity} {load.unit} ·{" "}
                  {load.manifestReference}
                </p>
                <p>
                  Delivery reference: {load.deliveryReference ?? c.unlinked}
                </p>
                <p className="text-xs">
                  {load.source} · {load.recordedByUserId} · {load.recordedAt}
                </p>
              </article>
            )),
          )}
          {!runs.some((item) => item.loads.length) && <p>{c.noLoads}</p>}
        </section>
      )}
      {isDesk && candidates && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">Dispatch resources</h2>
          <p className="text-sm">
            Eligibility and assignment conflicts are rechecked when the exact
            change is saved.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3>Authorized drivers</h3>
              {candidates.drivers.map((person) => (
                <p key={person.userId}>
                  {person.name} ·{" "}
                  {person.fleetIds
                    .map(
                      (id) =>
                        data.fleets.find((fleet) => fleet.id === id)?.name ??
                        id,
                    )
                    .join(", ")}
                </p>
              ))}
            </div>
            <div>
              <h3>Vehicles and trailers</h3>
              {candidates.equipment.map((asset) => (
                <p key={asset.id}>
                  {asset.name} · {asset.category} · {asset.status} ·{" "}
                  {asset.dispatchable
                    ? "Available for eligibility review"
                    : "Unavailable for dispatch"}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
      {isDesk && (
        <>
          <div className="fleet-summary">
            {[
              {
                href: "/fleet",
                title: c.awaitingDispatch,
                count: runs.filter((item) => item.status === "draft").length,
                hint: c.dispatchHint,
              },
              {
                href: "/fleet/runs",
                title: c.active,
                count: runs.filter((item) =>
                  ["dispatched", "acknowledged", "in_progress"].includes(
                    item.status,
                  ),
                ).length,
                hint: c.activeHint,
              },
              {
                href: "/fleet/review",
                title: c.review,
                count: runs.filter(
                  (item) => item.status === "submitted_for_review",
                ).length,
                hint: c.reviewHint,
              },
            ].map((card) => (
              <Link
                className="fleet-summary-card"
                key={card.href}
                href={card.href}
              >
                <h2>{card.title}</h2>
                <strong>{card.count}</strong>
                <span>{card.hint}</span>
              </Link>
            ))}
          </div>
          <section aria-label={c.fleetTools}>
            <div className="fleet-card-heading">
              <h2>{c.fleetTools}</h2>
              <p>
                {c.loadedRuns}: {data.runs.length}
              </p>
            </div>
            <div className="fleet-desk-links">
              <Link href="/fleet/map">
                <strong>{c.map}</strong>
                <span>{c.mapSummary}</span>
              </Link>
              <Link href="/fleet/drivers">
                <strong>{c.drivers}</strong>
                <span>{c.driverHint}</span>
              </Link>
              <Link href="/fleet/maintenance">
                <strong>{c.maintenance}</strong>
                <span>{c.maintenanceHint}</span>
              </Link>
            </div>
          </section>
        </>
      )}
      {create && (
        <section className="space-y-3 rounded-xl border p-4">
          <fieldset disabled={busy || createUnverified} className="space-y-3">
            <h2>{c.create}</h2>
            <p className="text-sm">{c.readiness}</p>
            <input
              aria-label={c.title}
              placeholder={c.title}
              className={selectClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <FleetScheduleFields
              value={scheduleDraft}
              onChange={setScheduleDraft}
              disabled={busy||orderPending}
            />
            {detailChoices.data?.details.length ? (
              <label>
                Saved Detail
                <select
                  aria-label="Saved Detail"
                  value={selectedDetailId}
                  onChange={(e) => {
                    const detail = detailChoices.data?.details.find(
                      (item) => item.id === e.target.value,
                    );
                    setSelectedDetailId(e.target.value);
                    if (detail) {
                      setDriver(String(detail.driverUserId));
                      setVehicle(detail.vehicleAssetId);
                      setTrailer(
                        packageChoices.data?.rigPackages
                          .find(
                            (item) =>
                              item.id === detail.rigPackageId &&
                              item.version === detail.rigPackageVersion,
                          )
                          ?.components.find((item) => item.role === "trailer")
                          ?.assetId ?? "",
                      );
                    }
                  }}
                >
                  <option value="">Select resources individually</option>
                  {detailChoices.data.details
                    .filter((item) => item.accessGroupIds.includes(fleetId))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · revision {item.version}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <select
              aria-label={c.driver}
              disabled={Boolean(selectedDetailId)}
              className={selectClass}
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            >
              <option value="">{c.driver}</option>
              {candidates?.drivers
                .filter((d) => d.fleetIds.includes(fleetId))
                .map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={c.vehicle}
              disabled={Boolean(selectedDetailId)}
              className={selectClass}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            >
              <option value="">{c.vehicle}</option>
              {candidates?.equipment
                .filter(
                  (e) =>
                    e.dispatchable &&
                    (
                      data.fleets.find((fleet) => fleet.id === fleetId)
                        ?.equipmentAssetIds ?? []
                    ).includes(e.id) &&
                    ["vehicle", "truck"].includes(e.category.toLowerCase()),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={c.trailer}
              disabled={Boolean(selectedDetailId)}
              className={selectClass}
              value={trailer}
              onChange={(e) => setTrailer(e.target.value)}
            >
              <option value="">
                {c.trailer}: {c.unlinked}
              </option>
              {candidates?.equipment
                .filter(
                  (e) =>
                    e.dispatchable &&
                    (
                      data.fleets.find((fleet) => fleet.id === fleetId)
                        ?.equipmentAssetIds ?? []
                    ).includes(e.id) &&
                    e.category.toLowerCase() === "trailer",
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <PngPillButton
              disabled={orderPending}
              onClick={() => {
                setPhysicalMode(!physicalMode);
                setPhysicalRoute(null);
                setUseRunOrder(false);
                setRunOrder(null);
              }}
            >
              {physicalMode
                ? "Use site-only route"
                : "Use Origins and Destinations"}
            </PngPillButton>
            <PngPillButton disabled={orderPending} onClick={()=>{setUseRunOrder(value=>!value);setPhysicalMode(true);setPhysicalRoute(null);setRunOrder(null);}}>
              {i18n.language.startsWith("es")?(useRunOrder?"Usar ruta de una sola vez":"Usar recorrido guardado"):(useRunOrder?"Use a one-time physical route":"Use saved Run")}
            </PngPillButton>
            {(["pickup", "delivery"] as const)
              .filter((kind) => !physicalMode || kind === "pickup")
              .map((kind) => (
                <select
                  key={kind}
                  aria-label={physicalMode ? "Billing site" : c[kind]}
                  className={selectClass}
                  value={kind === "pickup" ? pickup : delivery}
                  onChange={(e) =>
                    kind === "pickup"
                      ? setPickup(e.target.value)
                      : setDelivery(e.target.value)
                  }
                >
                  <option value="">
                    {physicalMode ? "Billing site" : c[kind]}
                  </option>
                  {data.fleets
                    .find((f) => f.id === fleetId)
                    ?.siteIds.map((id) => (
                      <option key={id} value={id}>
                        {c.site} {id}
                      </option>
                    ))}
                </select>
              ))}
            {physicalMode && useRunOrder && <FleetRunOrderChoice key={`${identity}:${fleetId}`} identity={identity} companyId={data.companyId} groupId={fleetId} disabled={busy||createUnverified} onChange={order=>{setRunOrder(order);setPhysicalRoute(order?fleetRunOrderRoute(order,()=>crypto.randomUUID()):null);}}/>}
            {physicalMode && !useRunOrder && directory.data && (
              <fieldset disabled={orderPending}>
              <FleetRouteFields
                value={physicalRoute}
                destinations={directory.data.destinations}
                onChange={value=>{setRunOrder(null);setPhysicalRoute(value);}}
              />
              </fieldset>
            )}
            {physicalMode&&!useRunOrder&&physicalRoute&&!runOrder&&<FleetSaveRunOrder key={`${identity}:${fleetId}`} identity={identity} companyId={data.companyId} groupId={fleetId} route={physicalRoute} timeZone={scheduleDraft.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone} initialName={title} disabled={busy||createUnverified} onPending={setOrderPending} onSaved={order=>{setRunOrder(order);void queryClient.invalidateQueries({queryKey:["fleet-run-orders",identity]});}}/>}
            {runOrder&&<p>{i18n.language.startsWith("es")?"Recorrido guardado":"Saved Run"} · {runOrder.name}</p>}
            {physicalMode && directory.isError && (
              <p role="alert">
                Locations unavailable. Open Origins and Destinations to check
                access.
              </p>
            )}
            <FleetRunBillingFields
              fleetId={fleetId}
              siteId={Number(pickup)}
              identity={identity}
              value={billing}
              onChange={setBilling}
              onValidityChange={setBillingValid}
              disabled={busy}
            />
            {!physicalMode && (
              <>
                {extraStops.map((stop, index) => (
                  <label key={index} className="block">
                    Cycle {Math.floor(index / 2) + 2} {stop.kind}
                    <select
                      disabled={busy}
                      value={stop.siteId}
                      onChange={(e) =>
                        setExtraStops(
                          extraStops.map((item, position) =>
                            position === index
                              ? { ...item, siteId: e.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Choose site</option>
                      {data.fleets
                        .find((fleet) => fleet.id === fleetId)
                        ?.siteIds.map((id) => (
                          <option key={id} value={id}>
                            {c.site} {id}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <PngPillButton
                  disabled={busy || extraStops.length >= 46}
                  onClick={() =>
                    setExtraStops([
                      ...extraStops,
                      { kind: "pickup", siteId: "" },
                      { kind: "delivery", siteId: "" },
                    ])
                  }
                >
                  Add hauling cycle
                </PngPillButton>
                {extraStops.length > 0 && (
                  <PngPillButton
                    disabled={busy}
                    onClick={() => setExtraStops(extraStops.slice(0, -2))}
                  >
                    Remove last cycle
                  </PngPillButton>
                )}
                <select
                  aria-label="Optional return site"
                  className={selectClass}
                  value={returnSite}
                  onChange={(e) => setReturnSite(e.target.value)}
                >
                  <option value="">Optional return site</option>
                  {data.fleets
                    .find((f) => f.id === fleetId)
                    ?.siteIds.map((id) => (
                      <option key={id} value={id}>
                        {c.site} {id}
                      </option>
                    ))}
                </select>
              </>
            )}
            <PngPillButton
              disabled={
                busy ||
                orderPending ||
                !billingValid ||
                !title ||
                !fleetId ||
                !driver ||
                !vehicle ||
                !pickup ||
                (physicalMode ? !physicalRoute : !delivery) ||
                (useRunOrder && (!runOrder || !selectedDetailId)) ||
                (runOrder && !selectedDetailId) ||
                (!physicalMode && extraStops.some((stop) => !stop.siteId))
              }
              onClick={() => void saveRun()}
            >
              {c.submit}
            </PngPillButton>
          </fieldset>
          {createUnverified && (
            <div role="status" className="space-y-2">
              <p>
                {i18n.language.startsWith("es")
                  ? "No se confirmó el guardado del recorrido y ticket. Reintente la misma solicitud para evitar duplicados."
                  : "Run and ticket save was not confirmed. Retry the exact request to avoid duplicates."}
              </p>
              <PngPillButton disabled={busy} onClick={() => void saveRun()}>
                {i18n.language.startsWith("es")
                  ? "Reintentar guardado"
                  : "Retry exact run save"}
              </PngPillButton>
            </div>
          )}
        </section>
      )}
      {section === "history" && (
        <FleetRouteReplay identity={identity} runs={runs} />
      )}
      {isMap && (
        <FleetOperationsMap
          runs={runs}
          positions={observations}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setPending(null);
          }}
        />
      )}
      {showDetails && (
        <div className="fleet-run-detail" id="fleet-run-detail" ref={detailRef}>
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-semibold">{mine ? c.myRun : c.selected}</h2>
            {!run ? (
              <p>{c.noSelection}</p>
            ) : (
              <>
                <h3 className="text-lg">{run.title}</h3>
                {run.linkedTicketId && !run.ticketReference &&
                  (data.capabilities.canManage ||
                    data.capabilities.canDispatch) && (
                    <FleetBillingTicketPanel
                      key={`${identity}:${run.linkedTicketId}`}
                      identity={identity}
                      ticketId={run.linkedTicketId}
                    />
                  )}
                {run.billing && (
                  <p>
                    AFE: {run.billing.afeNumber || "—"} ·{" "}
                    {i18n.language.startsWith("es")
                      ? "Fecha de trabajo"
                      : "Work date"}
                    : {run.billing.workDate}
                  </p>
                )}
                <p>
                  {run.status} · {c.version} {run.version}
                </p>
                <p>
                  {c.driver}:{" "}
                  {candidates?.drivers.find(
                    (d) => d.userId === run.driverUserId,
                  )?.name ??
                    run.labels?.driverName ??
                    run.driverUserId}
                </p>
                <p>
                  {c.vehicle}:{" "}
                  {candidates?.equipment.find(
                    (e) => e.id === run.vehicleAssetId,
                  )?.name ??
                    run.labels?.vehicleName ??
                    run.vehicleAssetId}
                </p>
                {run.schedule && (
                  <p>
                    {c.plannedHours}:{" "}
                    {new Date(run.schedule.plannedStartAt).toLocaleString(
                      i18n.language,
                      { timeZone: run.schedule.timezone },
                    )}{" "}
                    –{" "}
                    {new Date(run.schedule.plannedEndAt).toLocaleString(
                      i18n.language,
                      { timeZone: run.schedule.timezone },
                    )}{" "}
                    · {run.schedule.timezone}
                  </p>
                )}
                {run.canEditDraft === true && (
                  <FleetDraftEditor
                    key={run.id}
                    run={run}
                    sites={
                      data.fleets.find((fleet) => fleet.id === run.fleetId)
                        ?.siteIds ?? []
                    }
                    onSaved={reload}
                  />
                )}
                <Link href={`/fleet/runs/${run.id}`}>{c.openRun}</Link>
                <p className="text-xs">{c.routeUnavailable}</p>
                <div className="fleet-detail-group">
                  <h3>{c.stops}</h3>
                  <p>
                    {c.trailer}:{" "}
                    {run.labels?.trailerName ??
                      candidates?.equipment.find(
                        (asset) => asset.id === run.trailerAssetId,
                      )?.name ??
                      (run.trailerAssetId ? run.trailerAssetId : c.unlinked)}
                  </p>
                  <p className="text-xs">
                    Current stop:{" "}
                    {run.currentStopId
                      ? run.stops.find((stop) => stop.id === run.currentStopId)
                          ?.sequence! + 1
                      : "Traveling / not at a stop"}{" "}
                    · Visited: {run.visitedStopIds.length}/{run.stops.length}
                  </p>
                  <ol className="list-decimal pl-5">
                    {[...run.stops]
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((stop) => (
                        <li key={stop.id}>
                          {stop.kind} ·{" "}
                          {run.labels?.sites.find(
                            (site) => site.siteId === stop.siteId,
                          )?.name ?? `${c.site} ${stop.siteId}`}
                        </li>
                      ))}
                  </ol>
                </div>
                <details className="fleet-detail-group">
                  <summary>{c.runRecords}</summary>
                  <h3>Reported meter and fuel records</h3>
                  <ul>
                    {run.records.map((record) => (
                      <li key={record.id}>
                        {record.kind} · {record.reading ?? record.quantity}{" "}
                        {record.unit} · {record.notes} · {record.source} ·{" "}
                        {record.recordedAt}
                      </li>
                    ))}
                  </ul>
                  <h3>{c.loads}</h3>
                  {!run.loads.length && <p>{c.noLoads}</p>}
                  <ul>
                    {run.loads.map((load) => (
                      <li key={load.id}>
                        {load.commodity} · {load.quantity} {load.unit} ·{" "}
                        {load.manifestReference} ·{" "}
                        {load.transferOut
                          ? `${c.cargoTransferredOut} · ${load.transferOut.otherRunId}`
                          : load.deliveredAt
                            ? `Delivered ${load.deliveredAt}`
                            : "Awaiting delivery"}{" "}
                        {load.transferIn && (
                          <p>
                            {c.cargoTransferredIn} ·{" "}
                            {load.transferIn.otherRunId}
                          </p>
                        )}
                        · {load.source}
                        {Object.entries(load.manifestValues ?? {}).map(
                          ([id, value]) => (
                            <p key={id}>
                              {run.operationalProfile?.manifestFields.find(
                                (field) => field.id === id,
                              )?.label ?? id}
                              : {value}
                            </p>
                          ),
                        )}
                      </li>
                    ))}
                  </ul>
                  <h3>Driver inspection reports</h3>
                  <ul>
                    {run.inspections.map((inspection, index) => (
                      <li key={index}>
                        {inspection.outcome} · {inspection.notes} ·{" "}
                        {inspection.recordedAt} · {inspection.source}
                        {inspection.responses?.map((answer) => (
                          <p key={answer.id}>
                            {run.operationalProfile?.inspectionItems.find(
                              (item) => item.id === answer.id,
                            )?.label ?? answer.id}
                            : {answer.outcome} · {answer.notes ?? ""}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                  {run.linkedTicketId && (
                    <Link href={`/tickets/${run.linkedTicketId}`}>
                      {c.ticket} #{run.linkedTicketId}
                    </Link>
                  )}
                </details>
                <h3>{c.availableActions}</h3>
                <div className="fleet-detail-tools">
                  <FleetEtaPanel
                    key={`${run.id}:${run.version}`}
                    run={run}
                    identity={identity}
                  />
                  <FleetReplacementPanel
                    key={run.id}
                    run={run}
                    identity={identity}
                    canDispatch={data.capabilities.canDispatch}
                    equipment={(candidates?.equipment ?? []).filter((item) =>
                      (
                        data.fleets.find((fleet) => fleet.id === run.fleetId)
                          ?.equipmentAssetIds ?? []
                      ).includes(item.id),
                    )}
                    onSaved={reload}
                  />
                  <FleetCargoPanel
                    key={run.id}
                    run={run}
                    runs={data.runs}
                    identity={identity}
                    canDispatch={data.capabilities.canDispatch}
                    onSaved={reload}
                  />
                  <FleetDriverAvailability
                    key={`${identity}:${run.id}:availability`}
                    driverUserId={run.driverUserId}
                    runId={run.id}
                  />
                  <FleetReviewPacketPanel run={run} identity={identity} />
                  {work.session&&run.ticketReference&&<FleetCommercialWork key={`commercial:${identity}:${run.id}`} session={work.session} run={run} pending={work.commands.some(command=>("activity" in command.payload&&command.payload.activity.id===run.id)||(command.kind==="ticket.finalize"&&command.payload.ticket.id===run.linkedTicketId))} onChanged={()=>{void work.refresh();void queryClient.invalidateQueries({queryKey:["fleet",identity]});}}/>}
                  {work.session&&run.ticketReference?<FleetRetainedEvidence session={work.session} run={run} onChanged={()=>void work.refresh()}/>:<FleetEvidencePanel
                    key={run.id}
                    run={run}
                    identity={identity}
                    userId={userId}
                    canAdd={
                      data.capabilities.canDrive &&
                      run.driverUserId === userId &&
                      ["acknowledged", "in_progress"].includes(run.status)
                    }
                    onSaved={reload}
                  />}
                  <FleetGateObservationsPanel
                    key={run.id}
                    run={run}
                    identity={identity}
                    onSaved={reload}
                  />
                </div>
                {devicePreview && <p>Device-only sequence — pending server acceptance. The map and run status show canonical records.</p>}
                {!!devicePreviewError && <p role="alert">{devicePreviewError}</p>}
                <div className="flex flex-wrap gap-2">
                  {actionRun!.allowedActions.map((action) => (
                    <PngPillButton
                      key={action}
                      disabled={busy || !!devicePreviewError}
                      onClick={async () => {
                        if (action === "submit_closeout") {
                          setBusy(true);
                          try {
                            const packet = await fleetClient.reviewPacket(
                              run.id,
                            );
                            if (
                              packet.runId !== run.id ||
                              packet.runVersion !== run.version
                            ) {
                              setNotice(c.packetUnavailable);
                              return;
                            }
                            if (packet.missingRequiredCount > 0) {
                              setNotice(c.packetIncomplete);
                              return;
                            }
                          } catch {
                            setNotice(c.packetUnavailable);
                            return;
                          } finally {
                            setBusy(false);
                          }
                        }
                        setReason("");
                        setPending({
                          id: run.id,
                          input: {
                            operationId: crypto.randomUUID(),
                            expectedVersion: actionRun!.version,
                            capturedAt: new Date().toISOString(),
                            source: "user_report",
                            action,
                            ...(action === "record_load"
                              ? { loadId: crypto.randomUUID() }
                              : {}),
                          },
                        });
                      }}
                    >
                      {action === "submit_closeout"
                        ? i18n.language.startsWith("es")
                          ? "Cerrar recorrido"
                          : "Close Run"
                        : action === "acknowledge"
                          ? c.acknowledge
                          : action === "dispatch"
                            ? c.dispatchRun
                            : action === "cancel"
                              ? c.cancelRun
                              : action === "reassign"
                                ? c.reassign
                                : action.replaceAll("_", " ")}
                    </PngPillButton>
                  ))}
                </div>
                {pending?.id === run.id && (
                  <div className="space-y-2 rounded border p-3">
                    <p>
                      {c.reviewChange} {pending.input.action} · v
                      {pending.input.expectedVersion}
                    </p>
                    {pending.input.action === "cancel" && (
                      <input
                        disabled={busy}
                        aria-label={c.reason}
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          setPending({
                            ...pending,
                            input: {
                              ...pending.input,
                              operationId: crypto.randomUUID(),
                              reason: e.target.value,
                            },
                          });
                        }}
                      />
                    )}
                    {pending.input.action === "reassign" && (
                      <>
                        <select
                          disabled={busy}
                          aria-label={c.driver}
                          value={pending.input.driverUserId ?? ""}
                          onChange={(e) =>
                            setPending({
                              ...pending,
                              input: {
                                ...pending.input,
                                operationId: crypto.randomUUID(),
                                driverUserId: Number(e.target.value),
                              },
                            })
                          }
                        >
                          <option value="">{c.driver}</option>
                          {candidates?.drivers
                            .filter((d) => d.fleetIds.includes(run.fleetId))
                            .map((d) => (
                              <option key={d.userId} value={d.userId}>
                                {d.name}
                              </option>
                            ))}
                        </select>
                        <select
                          aria-label={c.vehicle}
                          disabled={busy}
                          value={pending.input.vehicleAssetId ?? ""}
                          onChange={(e) =>
                            setPending({
                              ...pending,
                              input: {
                                ...pending.input,
                                operationId: crypto.randomUUID(),
                                vehicleAssetId: e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">Keep current vehicle</option>
                          {candidates?.equipment
                            .filter(
                              (e) =>
                                e.dispatchable &&
                                (
                                  data.fleets.find(
                                    (fleet) => fleet.id === run.fleetId,
                                  )?.equipmentAssetIds ?? []
                                ).includes(e.id) &&
                                ["vehicle", "truck"].includes(
                                  e.category.toLowerCase(),
                                ),
                            )
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </select>
                        <select
                          aria-label={c.trailer}
                          disabled={busy}
                          value={
                            pending.input.trailerAssetId === null
                              ? "none"
                              : (pending.input.trailerAssetId ?? "")
                          }
                          onChange={(e) =>
                            setPending({
                              ...pending,
                              input: {
                                ...pending.input,
                                operationId: crypto.randomUUID(),
                                trailerAssetId:
                                  e.target.value === "none"
                                    ? null
                                    : e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">Keep current trailer</option>
                          <option value="none">Remove trailer</option>
                          {candidates?.equipment
                            .filter(
                              (e) =>
                                e.dispatchable &&
                                (
                                  data.fleets.find(
                                    (fleet) => fleet.id === run.fleetId,
                                  )?.equipmentAssetIds ?? []
                                ).includes(e.id) &&
                                e.category.toLowerCase() === "trailer",
                            )
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </select>
                      </>
                    )}
                    <FleetActionFields
                      tickets={candidates?.tickets}
                      run={formRun!}
                      input={pending.input}
                      disabled={busy}
                      onChange={(input) =>
                        setPending({
                          ...pending,
                          input: { ...input, operationId: crypto.randomUUID() },
                        })
                      }
                    />
                    <PngPillButton
                      disabled={
                        busy || !fleetActionComplete(pending.input, formRun)
                      }
                      onClick={() => void saveAction()}
                    >
                      {c.submit}
                    </PngPillButton>
                    <PngPillButton
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      {c.cancel}
                    </PngPillButton>
                  </div>
                )}
                <details className="fleet-detail-group">
                  <summary>{c.events}</summary>
                  <ul className="text-xs">
                    {run.events.map((event) => (
                      <li key={event.id}>
                        {event.type.replaceAll("_", " ")} · {c.actor}{" "}
                        {event.actorUserId} · {c.accepted} {event.recordedAt}
                        {event.capturedAt && (
                          <p>
                            {c.captured} {event.capturedAt} · {event.source}
                          </p>
                        )}
                        {["reason", "notes", "decision"].map((key) =>
                          typeof event.details?.[key] === "string" ? (
                            <p key={key}>{String(event.details?.[key])}</p>
                          ) : null,
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </section>
        </div>
      )}
      {showRunList && (
        <section className="rounded-xl border p-4">
          <h2 className="font-semibold">
            {mine ? c.assigned : c.runs} ({runs.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            {c.loadedRuns}: {data.runs.length}
          </p>
          {overview.hasNextPage && (
            <PngPillButton
              disabled={overview.isFetchingNextPage || !!offlineAt}
              onClick={() => void overview.fetchNextPage()}
            >
              {c.loadMore}
            </PngPillButton>
          )}
          {!runs.length && <p>{mine ? c.noAssigned : c.noRuns}</p>}
          <div className="fleet-run-list">
            {runs.map((item) => (
              <button
                key={item.id}
                className="fleet-run-row"
                onClick={() => {
                  setSelected(item.id);
                  setPending(null);
                }}
                aria-pressed={selected === item.id}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.labels?.driverName ??
                      `${c.driver} ${item.driverUserId}`}{" "}
                    · {item.labels?.vehicleName ?? c.unlinked}
                  </small>
                </span>
                <ImagePill
                  color={
                    item.status === "in_progress" || item.status === "completed"
                      ? "green"
                      : item.status === "cancelled"
                        ? "red"
                        : item.status === "dispatched" ||
                            item.status === "acknowledged"
                          ? "blue"
                          : "amber"
                  }
                >
                  {item.status.replaceAll("_", " ")}
                </ImagePill>
              </button>
            ))}
          </div>
        </section>
      )}
      {data.unavailableIntegrations.length > 0 && (
        <p className="text-sm text-muted-foreground">{c.unavailableTracking}</p>
      )}
    </main>
  );
}
