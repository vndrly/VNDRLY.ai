import "@/lib/gate-operational-helpers";
import { createContext, useContext, useEffect, useCallback, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, ListTodo, X } from "lucide-react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import { NextStepsAvatar } from "./next-steps-avatar";
import { useBrand } from "@/hooks/use-brand";
import { useAccountNextSteps } from "@/hooks/use-account-next-steps";
import { useAuth } from "@/hooks/use-auth";
import { actionableNextSteps, compareNextSteps, firstWatchLocationLabel, guidedEmployeeHref, nextStepGroups, groupGateWorkflows, type AccountNextStepsSummary, type NextStepWorkflow } from "@/lib/next-steps-model";
import { gateHelperDefinition, gateHelpersRevision, subscribeGateHelpers, type GateHelperKey, type GateHelperContext, type GateHelperStep, type GateCompletionProof } from "@/lib/gate-helper-registry";
import { GuidedTargetProvider, GuidedHelperPortal, GuidanceTargetStatus, useGuidedTarget } from "./guided-target";
import "./next-steps.css";
import { parseAskVGateGuidance, type AskVGateGuidance } from "@workspace/gate-booth";
import { uploadFleetEvidence, type FleetEvidenceUpload } from "@/lib/fleet-evidence-upload";

export type SavedNextStepsWorker =
  | { kind: "direct"; vendorPeopleId: number; userId?: number | null; name: string }
  | { kind: "managed"; managedWorkerId: string; managedOrganizationId: string; userId: number; name: string };

type Plan = { scope: string; open: boolean; selectedId: string | null; visited: boolean; seen: string; worker?: SavedNextStepsWorker; onDemand?: NextStepWorkflow };
type NextStepsContextValue = {
  scope: string; open: boolean; enabled: boolean; count: number; attention: boolean; canManageStaff: boolean;
  isPending: boolean; isError: boolean; selected: NextStepWorkflow | null;
  partnerSettings?: AccountNextStepsSummary["partnerSettings"];
  waiting?: string | null;
  assistantContext?: AskVGateGuidance;
  savedWorker?: SavedNextStepsWorker;
  triggerRef: RefObject<HTMLButtonElement | null>;
  show: () => void; close: () => void; stopHelper: () => void; refresh: () => Promise<unknown>;
  select: (workflow: NextStepWorkflow) => void;
  startHelper: (key: GateHelperKey, context?: GateHelperContext) => boolean;
  resumeHelper: (key: GateHelperKey) => Promise<"started" | "complete" | "unavailable" | "busy">;
  updateHelperStep: (key: GateHelperKey, step: GateHelperStep) => void;
  setWorkflowOffers: (sourceId: string, workflows: NextStepWorkflow[]) => () => void;
  recordCompletion: (key: GateHelperKey, proof: GateCompletionProof) => Promise<boolean>;
  continueWorkflow: (workflow: NextStepWorkflow) => void;
  workerSaved: (worker: SavedNextStepsWorker) => void;
};
const NextStepsContext = createContext<NextStepsContextValue | null>(null);
export function useNextSteps() { return useContext(NextStepsContext); }

/** One saved summary and one in-memory plan per active company; pages never refetch it independently. */
export function NextStepsProvider({ children }: { children: ReactNode }) {
  const account = useAccountNextSteps();
  const cache = useQueryClient();
  const [, navigate] = useLocation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scopeRef = useRef(account.scope);
  const guidedKeys = useRef(new Set<string>());
  const completionReceipts = useRef(new Map<string, Promise<boolean>>());
  if (scopeRef.current !== account.scope) { guidedKeys.current.clear(); completionReceipts.current.clear(); }
  scopeRef.current = account.scope;
  useSyncExternalStore(subscribeGateHelpers, gateHelpersRevision, gateHelpersRevision);
  const offers = useRef(new Map<string, { token: symbol; scope: string; workflows: NextStepWorkflow[] }>());
  const [, setOffersRevision] = useState(0);
  const offeredWorkflows = [...offers.current.values()].filter(entry => entry.scope === account.scope).flatMap(entry => entry.workflows).filter(workflow => gateHelperDefinition(workflow.id as GateHelperKey));
  const workflows = [...new Map([...nextStepGroups(account.query.data).flatMap(group => group.workflows), ...offeredWorkflows].map(workflow => [workflow.id, workflow])).values()];
  const allGroups = groupGateWorkflows(workflows);
  // The menu is a small queue of workflows with an action the user can take now.
  const mastery = account.query.data?.helperProgress;
  const savedIds = new Set(account.query.data?.workflows?.map(item => item.id));
  const staffingShift = workflows.find(item => item.id === "gate-staffing-recovery" && item.action)?.context?.shiftId;
  const available = workflows.filter(item => item.action && (savedIds.has(item.id) || (mastery?.independentCompletions[item.id] ?? 0) < (mastery?.independentThreshold ?? 3)))
    .filter(item => !staffingShift || item.id !== "gate-shift-scheduling" || item.context?.shiftId !== staffingShift)
    .sort(compareNextSteps).slice(0, 5);
  const availableIds = new Set(available.map(item => item.id));
  const groups = allGroups.map(group => ({ ...group, workflows: group.workflows.filter(item => availableIds.has(item.id)) })).filter(group => group.workflows.length);
  const count = actionableNextSteps(groups);
  const fingerprint = available.map(item => `${item.id}:${item.action?.href ?? ""}`).join("|");
  const emptyPlan = (): Plan => ({ scope: account.scope, open: false, selectedId: null, visited: false, seen: "" });
  const [storedPlan, setPlan] = useState<Plan>(emptyPlan);
  // Ignore the previous company's UI immediately, before effects run.
  const plan = storedPlan.scope === account.scope ? storedPlan : emptyPlan();
  const selected = plan.onDemand ?? workflows.find(item => item.id === plan.selectedId) ?? null;
  const assistantWorkflow = (workflow: NextStepWorkflow) => ({ key: workflow.id, title: workflow.title, action: workflow.action, message: workflow.message, context: workflow.context });
  const assistantContext = account.enabled && account.vendorId ? parseAskVGateGuidance({
    companyId: account.vendorId,
    state: account.query.isError ? "unavailable" : account.query.isPending ? "checking" : "ready",
    active: selected ? assistantWorkflow(selected) : null,
    available: available.map(assistantWorkflow),
  }) : undefined;
  const selectionRef = useRef(selected); selectionRef.current = selected;
  useEffect(() => { setPlan(current => current.scope === account.scope ? current : emptyPlan()); }, [account.scope]);
  const refresh = useCallback(() => cache.invalidateQueries({ queryKey: account.queryKey, exact: true }, { cancelRefetch: false }), [cache, account.scope]);
  const recordCompletion = useCallback((key: GateHelperKey, proof: GateCompletionProof): Promise<boolean> => {
    if (scopeRef.current !== account.scope) return Promise.resolve(false);
    const receiptId = `${account.scope}:${key}:${proof.recordType}:${proof.recordId}:${proof.siteId}`;
    const previous = completionReceipts.current.get(receiptId);
    if (previous) return previous;
    const mode = guidedKeys.current.has(key) || selectionRef.current ? "guided" : "independent";
    const request = (async () => {
      try {
        const response = await fetch("/api/workflow-helpers/completions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-VNDRLY-Actor-User": String(account.user?.userId), "X-VNDRLY-Vendor": String(account.vendorId), "X-VNDRLY-Membership": String(account.user?.activeMembershipId) }, body: JSON.stringify({ workflowKey: key, mode, ...proof }) });
        const receipt = await response.json();
        if (!response.ok || receipt?.recorded !== true) throw new Error("The saved Gate outcome could not be checked.");
        if (scopeRef.current !== account.scope) return false;
        guidedKeys.current.delete(key);
        setPlan(current => current.scope === account.scope && current.selectedId === key ? { ...current, selectedId: null, onDemand: undefined, worker: undefined, visited: false } : current);
        await refresh();
        if (receipt.helperProgress && scopeRef.current === account.scope) cache.setQueryData(account.queryKey, (current: import("@/lib/next-steps-model").AccountNextStepsSummary | undefined) => current ? { ...current, helperProgress: receipt.helperProgress } : current);
        return true;
      } catch {
        completionReceipts.current.delete(receiptId);
        return false;
      }
    })();
    completionReceipts.current.set(receiptId, request);
    return request;
  }, [account.scope, refresh]);
  const updateHelperStep = useCallback((key: GateHelperKey, step: GateHelperStep) => {
    const active = selectionRef.current;
    if (scopeRef.current !== account.scope || active?.id !== key) return;
    setPlan(current => current.scope === account.scope && current.selectedId === key ? { ...current, onDemand: { ...active, ...step } } : current);
  }, [account.scope]);
  const setWorkflowOffers = useCallback((sourceId: string, values: NextStepWorkflow[]) => {
    if (scopeRef.current !== account.scope) return () => {};
    const token = Symbol(sourceId);
    offers.current.set(sourceId, { token, scope: account.scope, workflows: values });
    setOffersRevision(value => value + 1);
    return () => { if (offers.current.get(sourceId)?.token === token) { offers.current.delete(sourceId); setOffersRevision(value => value + 1); } };
  }, [account.scope]);
  // Only a confirmed saved watch plus its ticket completes the whole first-watch workflow.
  const completedWatch = account.query.data?.firstWatch;
  useEffect(() => {
    const context = completedWatch?.context;
    if (plan.selectedId !== "first-watch" || !completedWatch?.complete || !context?.watchId || !context.ticketId || !context.siteId) return;
    if (plan.onDemand && plan.onDemand.context?.watchId === context.watchId) return;
    void recordCompletion("first-watch", { recordType: "gate-watch", recordId: context.watchId, siteId: context.siteId });
  }, [account.scope, plan.selectedId, completedWatch?.complete, completedWatch?.context?.watchId, completedWatch?.context?.ticketId, plan.onDemand]);
  const close = () => { setPlan(current => ({ ...(current.scope === account.scope ? current : emptyPlan()), open: false, seen: fingerprint })); triggerRef.current?.focus(); };
  const value: NextStepsContextValue = {
    scope: account.scope, enabled: account.enabled, open: plan.open, count, canManageStaff: account.vendorAdmin,
    partnerSettings: account.query.data?.partnerSettings,
    waiting: account.query.data?.firstWatch?.complete === false && !account.query.data.firstWatch.action
      ? account.query.data.firstWatch.message : null,
    attention: account.enabled && count > 0 && !plan.open && !selected && plan.seen !== fingerprint,
    isPending: account.query.isPending, isError: account.query.isError,
    selected, assistantContext, savedWorker: plan.worker, triggerRef,
    show: () => {
      setPlan({ ...plan, open: true, seen: fingerprint, visited: false });
      // A return from a form rereads its saved outcome; normal navigation and initial opens reuse the cache.
      if (plan.visited) void refresh();
    },
    close,
    stopHelper: () => setPlan({ ...plan, selectedId: null, worker: undefined, visited: false, onDemand: undefined, seen: fingerprint }),
    refresh,
    select: workflow => { if (!selected || selected.id === workflow.id) { guidedKeys.current.add(workflow.id); setPlan({ ...plan, open: false, selectedId: workflow.id, seen: fingerprint, onDemand: undefined }); } },
    recordCompletion,
    updateHelperStep,
    setWorkflowOffers,
    startHelper: (key, context) => {
      if (!account.enabled || selected && selected.id !== key) return false;
      // Reopening this same workflow from askV must retain its current form and step.
      if (selected?.id === key) {
        const chosen = selected.context;
        if (context?.siteId && chosen?.siteId !== context.siteId || context?.stationId && chosen?.stationId !== context.stationId || context?.shiftId && chosen?.shiftId !== context.shiftId || context?.vehicleId && String(chosen?.vehicleId) !== String(context.vehicleId)) return false;
        setPlan({ ...plan, open: false });
        return true;
      }
      const definition = gateHelperDefinition(key);
      if (!definition || definition.access === "admin" && !account.vendorAdmin
        || definition.access === "office" && !account.vendorAdmin && account.user?.vendorRole !== "office" && account.user?.vendorRole !== "gate_supervisor") return false;
      const candidate = workflows.find(item => item.id === key);
      const sameContext = (!context?.siteId || candidate?.context?.siteId === context.siteId) && (!context?.stationId || candidate?.context?.stationId === context.stationId) && (!context?.shiftId || candidate?.context?.shiftId === context.shiftId);
      const current = sameContext ? candidate : undefined;
      const savedContext = account.query.data?.firstWatch?.context;
      // A saved wait (especially a watch awaiting its ticket) is a step, not a missing plan.
      const savedWaiting = key === "first-watch" && sameContext && candidate;
      const onDemand = current?.action || savedWaiting ? undefined : definition.create({ ...savedContext, ...context });
      if (savedWaiting) {
        guidedKeys.current.add(key);
        setPlan({ ...plan, selectedId: key, onDemand: undefined, open: false, seen: fingerprint });
        return true;
      }
      if (key === "first-watch" && !current?.action && !account.vendorAdmin) return false;
      if (!current?.action && !onDemand) return false;
      guidedKeys.current.add(key);
      setPlan({ ...plan, selectedId: key, onDemand: onDemand ?? undefined, open: false, seen: fingerprint });
      return true;
    },
    resumeHelper: async key => {
      if (!account.enabled || scopeRef.current !== account.scope) return "unavailable";
      if (selectionRef.current) return selectionRef.current.id === key && value.startHelper(key) ? "started" : "busy";
      if (key !== "first-watch") return value.startHelper(key) ? "started" : "unavailable";
      // Resume from current saved records, rather than a stale conversation link.
      const result = await account.query.refetch({ cancelRefetch: false });
      if (scopeRef.current !== account.scope || result.isError || !result.data?.firstWatch) return "unavailable";
      const currentSelection = selectionRef.current as NextStepWorkflow | null;
      if (currentSelection) return currentSelection.id === key ? "started" : "busy";
      if (result.data.firstWatch.complete) return "complete";
      guidedKeys.current.add(key);
      setPlan(current => ({ ...(current.scope === account.scope ? current : emptyPlan()), selectedId: key, onDemand: undefined, open: false, seen: fingerprint }));
      return "started";
    },
    continueWorkflow: workflow => {
      if (!workflow.action) return;
      setPlan({ ...plan, open: false, selectedId: workflow.id, visited: true });
      navigate(guidedEmployeeHref(workflow.action));
    },
    workerSaved: worker => {
      if (scopeRef.current !== account.scope) return;
      setPlan(current => {
        const currentPlan = current.scope === account.scope ? current : emptyPlan();
        if (currentPlan.selectedId !== "first-watch") return current;
        if (currentPlan.onDemand && worker.userId) {
          const context = currentPlan.onDemand.context;
          const query = new URLSearchParams({ ...(context?.siteId ? { siteId: String(context.siteId) } : {}), ...(context?.stationId ? { stationId: context.stationId } : {}), ...(context?.shiftId ? { shiftId: context.shiftId } : {}), ...(context?.day ? { day: context.day } : {}), employee: String(worker.userId) });
          return { ...currentPlan, worker, selectedId: "first-watch", visited: true, onDemand: { ...currentPlan.onDemand, action: { title: "Review the saved station shift and employee assignment", href: `/work-hub/calendar?${query}` }, message: "The employee was saved. Review the station’s shift and explicitly save their assignment; existing assignments are retained until you change them." } };
        }
        return { ...currentPlan, worker, selectedId: "first-watch", visited: true };
      });
      // Existing employee editors invalidate this same query after successful saves.
    },
  };
  return <NextStepsContext.Provider value={value}><GuidedTargetProvider scope={account.scope} active={Boolean(selected)}>
    {children}
    {account.enabled && plan.open && <NextStepsPanel key={`menu:${account.scope}`} groups={groups} />}
    {account.enabled && selected && <ActiveWorkflowHelper key={`helper:${account.scope}`} workflow={selected} />}
  </GuidedTargetProvider></NextStepsContext.Provider>;
}

/** Place directly next to NotificationsBell in each shared navigation header. */
export function NextStepsNavButton({ className = "" }: { className?: string }) {
  const state = useNextSteps();
  if (!state?.enabled) return null;
  const status = state.isError ? "unavailable" : state.isPending ? "checking saved work" : `${state.count} available ${state.count === 1 ? "action" : "actions"}`;
  return <button ref={state.triggerRef} type="button" className={`next-steps-nav ${className}`} onClick={event => { state.triggerRef.current = event.currentTarget; if (state.open) state.close(); else state.show(); }}
    aria-label={`Next Steps, ${status}`} aria-expanded={state.open} aria-controls="next-steps-panel"
    data-attention={state.attention ? "gentle" : "none"} title={`Next Steps · ${status}`}>
    <ListTodo aria-hidden="true" className="next-steps-nav-icon" />
    <span className="next-steps-nav-count" aria-hidden="true">{state.isPending ? "…" : state.isError ? "?" : state.count}</span>
  </button>;
}

function PartnerOrderSettings({ settings }: { settings: NonNullable<AccountNextStepsSummary["partnerSettings"]> }) {
  const state = useNextSteps()!;
  const { user } = useAuth();
  const [ranks, setRanks] = useState<Record<number,string>>(() => Object.fromEntries(settings.order.map((id,index) => [id,String(index+1)])));
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  async function save() {
    const ranked = settings.options.filter(partner => ranks[partner.id]).map(partner => ({id:partner.id, rank:Number(ranks[partner.id])}));
    if (ranked.some(partner => !Number.isSafeInteger(partner.rank) || partner.rank < 1 || partner.rank > 100)
      || new Set(ranked.map(partner => partner.rank)).size !== ranked.length) {
      setMessage("Use distinct priorities from 1 to 100.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account-next-steps/partner-order", {
        method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({vendorId:settings.companyId,membershipId:user?.activeMembershipId,userId:user?.userId,order:ranked.sort((a,b) => a.rank-b.rank).map(partner => partner.id)}),
      });
      if (!response.ok) throw new Error("Partner priority could not be saved. Refresh Next Steps and try again.");
      await state.refresh();
      setMessage("Partner priority saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Partner priority could not be saved.");
    } finally { setBusy(false); }
  }
  return <details className="mt-4">
    <summary className="cursor-pointer">Company partner priority</summary>
    <p className="text-sm">Use 1 for the highest priority. Leave a partner blank to use the normal order.</p>
    {settings.options.map(partner => <label className="my-2 flex items-center justify-between gap-2" key={partner.id}>
      <span>{partner.name}</span>
      <input className="w-16 rounded border bg-transparent px-2" type="number" min={1} max={100} step={1} value={ranks[partner.id] ?? ""} disabled={busy} onChange={event => setRanks(current => ({...current,[partner.id]:event.target.value}))} />
    </label>)}
    <TogglePillButton color="brand" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save partner priority"}</TogglePillButton>
    {message && <p role="status">{message}</p>}
  </details>;
}

function NextStepsPanel({ groups }: { groups: ReturnType<typeof nextStepGroups> }) {
  const state = useNextSteps()!;
  const heading = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) state.close(); };
    const outside = (event: PointerEvent) => { if (!panelRef.current?.contains(event.target as Node) && !state.triggerRef.current?.contains(event.target as Node)) state.close(); };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [state.close]);
  return <aside ref={panelRef} id="next-steps-panel" className="next-steps-panel" aria-labelledby="next-steps-heading" data-testid="next-steps-panel" data-state={state.isPending ? "loading" : state.isError ? "error" : "settled"}>
    <NextStepsAvatar active /><header className="next-steps-panel-header"><div className="flex items-start gap-2"><div><h2 id="next-steps-heading" tabIndex={-1} ref={heading}>Next Steps</h2><p role="status" aria-live="polite">{state.isPending ? "Checking saved work…" : `${state.count} available ${state.count === 1 ? "action" : "actions"}`}</p></div></div>
      <button type="button" className="next-steps-icon-button" aria-label="Close Next Steps" onClick={state.close}><X aria-hidden="true" /></button>
    </header>
    <div className="next-steps-panel-body">
      {state.isError && <p role="status">Next Steps could not be refreshed. <button type="button" className="underline" onClick={() => void state.refresh()}>Retry</button></p>}
      <p className="mb-3 text-sm">Workflows with askV. Continue from your saved work, and ask V questions as you go.</p>
      {!state.isPending && !state.isError && groups.length === 0 && !state.waiting && <p>No guided steps need your action right now.</p>}
      {state.waiting && <p role="status" className="mb-3 text-sm">{state.waiting}</p>}
      {state.selected && <p className="mb-3 text-sm">Your current helper stays open as you work. Stop it with its own X before starting another.</p>}
      {groups.map(group => <section key={group.id} className="next-steps-function" aria-label={group.title}>
        <h3>{group.title}</h3>
        <ul>{group.workflows.map(workflow => <li key={workflow.id}>
          <button type="button" className="next-steps-workflow" disabled={!!state.selected && state.selected.id !== workflow.id} onClick={() => state.select(workflow)}><span>{workflow.title}<small>{state.selected?.id === workflow.id ? "Current helper" : "Start guided helper"}</small></span><ArrowRight aria-hidden="true" /></button>
          {workflow.context && <p className="next-steps-context">{firstWatchLocationLabel(workflow.context)}</p>}
        </li>)}</ul>
      </section>)}
      {state.canManageStaff && state.partnerSettings?.options.length ? <PartnerOrderSettings key={state.scope} settings={state.partnerSettings} /> : null}
    </div>
  </aside>;
}

function ActiveWorkflowHelper(props: Parameters<typeof WorkflowHelper>[0]) {
  const state = useNextSteps()!;
  const brand = useBrand();
  return <GuidedHelperPortal>{inModal => <aside style={inModal ? { position: "relative", top: "auto", right: "auto", bottom: "auto", width: "calc(100% - var(--next-steps-avatar-gutter))", marginLeft: "var(--next-steps-avatar-gutter)", maxHeight: "min(40dvh, 24rem)", flexShrink: 0, pointerEvents: "auto" } : undefined} onPointerDown={inModal ? event => event.stopPropagation() : undefined} onFocus={inModal ? event => event.stopPropagation() : undefined} className="next-steps-panel next-steps-active-helper" aria-label="Active Next Steps helper" data-testid="next-steps-active-helper">
    <NextStepsAvatar active /><header className="next-steps-panel-header"><div className="flex items-start gap-2"><div><h2>askV · Gate guidance</h2><p>{brand.name ?? "Your company"} · Your current Next Step.</p></div></div><button type="button" className="next-steps-icon-button" aria-label="Stop current helper" onClick={state.stopHelper}><X aria-hidden="true" /></button></header>
    <div className="next-steps-panel-body"><WorkflowHelper {...props} inModal={inModal} /></div>
  </aside>}</GuidedHelperPortal>;
}

function CompanyCoiHelper({ vendorId }: { vendorId: number }) {
  const state = useNextSteps()!;
  const upload = useRef<FleetEvidenceUpload | undefined>(undefined);
  const mounted = useRef(false);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function save() {
    if (!file || busy) return;
    const stage = upload.current?.file === file ? upload.current : {file};
    upload.current = stage;
    setBusy(true);
    setMessage("");
    try {
      const objectPath = await uploadFleetEvidence(stage, () => mounted.current, 25 * 1024 * 1024);
      if (!mounted.current) return;
      const response = await fetch("/api/account-next-steps/coi", {
        method:"POST", credentials:"include", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({vendorId,objectPath}),
      });
      if (!response.ok) throw new Error("The certificate could not be saved. Check the file and your current company, then retry.");
      if (mounted.current) await state.refresh();
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "The certificate could not be saved.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <div className="space-y-2">
    <label className="block">Certificate of insurance
      <input className="block w-full" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event => setFile(event.target.files?.[0])} />
    </label>
    {message && <p role="alert">{message}</p>}
    <TogglePillButton color="brand" disabled={busy || !file} onClick={() => void save()}>{busy ? "Saving…" : "Save certificate"}</TogglePillButton>
  </div>;
}

function WatchTicketConfirmation({ watchId, shiftId }: { watchId: string; shiftId: string }) {
  const { user } = useAuth();
  const state = useNextSteps()!;
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  async function confirm() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account-next-steps/watch-ticket", {
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({vendorId:user?.vendorId,membershipId:user?.activeMembershipId,userId:user?.userId,watchId,shiftId}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Ticket confirmation could not be checked.");
      if (!result.ticketId) setMessage("Your watch is saved. Its ticket is still awaiting confirmation.");
      await state.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ticket confirmation could not be checked.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <TogglePillButton color="brand" disabled={busy} onClick={() => void confirm()}>{busy ? "Checking…" : "Confirm saved watch ticket"}</TogglePillButton>
    {message && <p role="status">{message}</p>}
  </div>;
}

function WorkflowHelper({ workflow, inModal = false }: { workflow: NextStepWorkflow; inModal?: boolean }) {
  const state = useNextSteps()!;
  const companyDocument = workflow.action?.recordType === "company-coi" && typeof workflow.action.recordId === "number" ? workflow.action.recordId : null;
  const watchTicket = workflow.action?.recordType === "watch-ticket" && typeof workflow.action.recordId === "string" ? workflow.action.recordId : null;
  useGuidedTarget({ scopeId: "next-steps-current-helper", targetId: "continue", prompt: workflow.action?.href.startsWith("/field-employees") ? "Open Employees to choose a direct or contracted employee for this saved site." : "Open the saved record to continue." }, Boolean(workflow.action) && !companyDocument && !watchTicket, 1);
  return <section data-guidance-scope="next-steps-current-helper" aria-labelledby={`next-steps-workflow-${workflow.id}`} className="next-steps-helper">
    <button type="button" className="next-steps-back" disabled={inModal} title={inModal ? "Close this form before choosing another helper." : undefined} onClick={state.show}><ArrowLeft aria-hidden="true" />All Next Steps</button>
    <h3 id={`next-steps-workflow-${workflow.id}`}>{workflow.title}</h3>
    {workflow.context && <p>{firstWatchLocationLabel(workflow.context)}</p>}
    {workflow.kind === "first-watch" ? <>
      {workflow.action && <p><strong>Current saved step:</strong> {workflow.action.title}</p>}
      <p>{state.canManageStaff ? "Continue with this saved site, gate and shift. The gatekeeper’s ticket starts automatically with their saved watch." : "Continue with your saved site, gate and shift. Your ticket starts automatically with the saved watch."}</p>
      {state.savedWorker && <p className="next-steps-saved-worker">Saved {state.savedWorker.kind === "managed" ? "contracted employee" : "employee"}: {state.savedWorker.name}. Their existing profile and enrollment controls remain available on Employees.</p>}
      <details><summary className="cursor-pointer text-sm">{state.canManageStaff ? "Gate setup workflow" : "Your watch workflow"}</summary><ol className="next-steps-roadmap">{state.canManageStaff && <li>Choose a direct or contracted employee; save Gatekeeper access for an authorized site.</li>}{state.canManageStaff && <li>Create and save the station’s shift, then assign the employee.</li>}<li>The assigned gatekeeper uses Assume Watch when the shift begins.</li></ol></details>
    </> : workflow.steps ? <ol className="next-steps-roadmap">{workflow.steps.map(step => <li key={step}>{step}</li>)}</ol>
      : <p>{workflow.description ?? "Follow the guidance for this saved Gate workflow. Use the page’s existing controls and save your changes explicitly."}</p>}
    {workflow.message && <p role="status">{workflow.message}</p>}
    <GuidanceTargetStatus />
    {companyDocument ? <CompanyCoiHelper vendorId={companyDocument} />
      : watchTicket && workflow.context?.shiftId ? <WatchTicketConfirmation watchId={watchTicket} shiftId={workflow.context.shiftId} />
      : workflow.action && <TogglePillButton data-guidance-id="continue" color="brand" disabled={inModal} title={inModal ? "Finish or close this form before opening the next page." : undefined} onClick={() => state.continueWorkflow(workflow)}>{workflow.action.href.startsWith("/field-employees") ? "Choose or add employee" : workflow.action.title}<ArrowRight aria-hidden="true" className="h-4 w-4" /></TogglePillButton>}
    <button type="button" className="underline text-left" onClick={() => void state.refresh()}>Check saved progress</button>
    <p className="next-steps-helper-note">Ask V about this step while you work. Guidance advances from saved records. Closing askV or the Next Steps list keeps this workflow active; stopping guidance keeps your saved work.</p>
  </section>;
}
