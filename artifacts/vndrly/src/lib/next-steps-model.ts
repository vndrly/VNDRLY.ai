import { gateLocationLabel, partnerSiteLabel } from "./warwick-gate-label";

export type NextStepAction = { title: string; href: string; recordType?: string; recordId?: number | string };

export type FirstWatchContext = {
  siteName: string; stationName: string | null;
  partnerName?: string | null;
  gateLabelStations?: Parameters<typeof gateLocationLabel>[2];
  siteId?: number; stationId?: string | null; shiftId?: string | null;
  employeeId?: number | null; eligibleUserId?: number | null;
  assignedUserId?: number | null; watchId?: string | null; ticketId?: number | null;
  startsAt?: string | null; day?: string | null;
  employeeKind?: "direct" | "managed" | null; managedOrganizationId?: string | null; managedWorkerId?: string | null;
};

export function firstWatchLocationLabel(context: FirstWatchContext): string {
  const site = { name: context.siteName, partnerName: context.partnerName };
  const stations = context.gateLabelStations ?? [];
  const station = stations.find(row => row.id === context.stationId);
  if (station) return gateLocationLabel(site, station, stations);
  return context.stationName ? `${context.siteName} · ${context.stationName}` : partnerSiteLabel(site);
}

export type AccountNextStepsSummary = {
  setup: NextStepAction[];
  credentials: NextStepAction[];
  coiUploadNeeded?: boolean;
  workflows?: NextStepWorkflow[];
  partnerSettings?: {companyId:number; options:{id:number;name:string}[]; order:number[]};
  helperProgress?: { independentThreshold: number; independentCompletions: Record<string, number> };
  firstWatch: {
    complete: boolean; action: NextStepAction | null; message: string | null;
    context: FirstWatchContext | null;
  } | null;
};

export type GateWorkflowContext = Partial<FirstWatchContext> & { employeeUserId?: number; alertId?: string; movementId?: string; vehicleId?: number | string };

export type NextStepWorkflow = {
  id: string; title: string;
  kind: "first-watch" | "gate-operation" | "account";
  description?: string;
  action: NextStepAction | null;
  message?: string | null;
  context?: GateWorkflowContext | null;
  priority: number;
  deadline?: string;
  age?: string;
  partnerRank?: number;
  steps?: readonly string[];
  savedActions?: NextStepAction[];
};

export type NextStepGroup = { id: string; title: string; workflows: NextStepWorkflow[] };

export function compareNextSteps(a: NextStepWorkflow, b: NextStepWorkflow) {
  return a.priority - b.priority
    || (a.deadline ?? "\uffff").localeCompare(b.deadline ?? "\uffff")
    || (a.partnerRank ?? Number.MAX_SAFE_INTEGER) - (b.partnerRank ?? Number.MAX_SAFE_INTEGER)
    || (a.age ?? "\uffff").localeCompare(b.age ?? "\uffff")
    || a.id.localeCompare(b.id);
}

/** The returned unfinished records are the only source of workflows and counts. */
export function nextStepGroups(summary: AccountNextStepsSummary | undefined): NextStepGroup[] {
  if (!summary) return [];
  const groups = new Map<string, NextStepGroup>();
  const add = (id: string, title: string, workflow: NextStepWorkflow) => {
    if (!groups.has(id)) groups.set(id, { id, title, workflows: [] });
    groups.get(id)!.workflows.push(workflow);
  };
  const watch = summary.firstWatch;
  if (watch && !watch.complete) add("gate", "Gate Operations", {
    id: "first-watch", kind: "first-watch", title: "Start your first gate watch",
    action: watch.action, message: watch.message, context: watch.context,
    priority: watch.action ? 0 : 40,
  });
  const accountSteps: Record<string, {priority:number; steps:readonly string[]}> = {
    "existing-credential": {priority:30, steps:["Find the named credential in your existing records.", "Update its dates and attach the supporting document.", "Save and check the updated credential."]},
    "company-profile": {priority:50, steps:["Open your company profile and review the saved contact and address details.", "Fill the missing fields and save the profile."]},
    "worker-profile": {priority:50, steps:["Review your name and phone and save any missing details.", "Add a profile photo if one is missing."]},
    "service-catalog": {priority:50, steps:["Select the services your company offers.", "Enter rates for the selected services.", "Review and save the catalog."]},
    "company-coi": {priority:45, steps:["Choose the current certificate of insurance for this company.", "Confirm the selected file and save it to the company record."]},
  };
  const account = [...summary.setup, ...summary.credentials].flatMap(action => {
    const definition = action.recordType && accountSteps[action.recordType];
    if (!definition || action.recordId == null) return [];
    return [{id:`${action.recordType}:${action.recordId}`, kind:"account" as const, title:action.title, action, ...definition}];
  });
  return groupGateWorkflows([...groups.values()].flatMap(group => group.workflows).concat(summary.workflows ?? [], account));
}

export function groupGateWorkflows(workflows: NextStepWorkflow[]): NextStepGroup[] {
  const groups = new Map<string, NextStepGroup>();
  for (const workflow of workflows) {
    const [id, title] = workflow.id.startsWith("safety:") ? ["safety", "Safety"]
      : workflow.id.startsWith("work:") ? ["work", "Assigned Work"]
      : workflow.kind === "account" ? ["account", "Profile and Company"]
      : workflow.id === "gate-staffing-recovery" ? ["staffing", "Gate Staffing"]
      : workflow.id === "gate-shift-scheduling" ? ["scheduling", "Gate Scheduling"]
      : workflow.id.includes("vehicle") || workflow.id.includes("inner") || workflow.id.includes("turnaround") ? ["traffic", "Gate Traffic"]
      : ["gate", "Gate Operations"];
    if (!groups.has(id)) groups.set(id, { id, title, workflows: [] });
    groups.get(id)!.workflows.push(workflow);
  }
  for (const group of groups.values()) group.workflows.sort(compareNextSteps);
  return [...groups.values()].sort((a, b) => compareNextSteps(a.workflows[0], b.workflows[0]));
}

export function actionableNextSteps(groups: NextStepGroup[]) {
  return groups.flatMap(group => group.workflows).filter(workflow => workflow.action).length;
}

export function guidedEmployeeHref(action: NextStepAction) {
  if (!action.href.startsWith("/field-employees")) return action.href;
  const url = new URL(action.href, "https://vndrly.invalid");
  url.searchParams.set("nextSteps", "first-watch");
  return `${url.pathname}${url.search}${url.hash}`;
}
