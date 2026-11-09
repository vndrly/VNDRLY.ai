export type NextStepAction = { title: string; href: string; recordType?: string; recordId?: number | string };

export type FirstWatchContext = {
  siteName: string; stationName: string | null;
  siteId?: number; stationId?: string | null; shiftId?: string | null;
  employeeId?: number | null; eligibleUserId?: number | null;
  assignedUserId?: number | null; watchId?: string | null; ticketId?: number | null;
  startsAt?: string | null; day?: string | null;
  employeeKind?: "direct" | "managed" | null; managedOrganizationId?: string | null; managedWorkerId?: string | null;
};

export type AccountNextStepsSummary = {
  setup: NextStepAction[];
  credentials: NextStepAction[];
  coiUploadNeeded?: boolean;
  helperProgress?: { independentThreshold: number; independentCompletions: Record<string, number> };
  firstWatch: {
    complete: boolean; action: NextStepAction | null; message: string | null;
    context: FirstWatchContext | null;
  } | null;
};

export type GateWorkflowContext = Partial<FirstWatchContext> & { employeeUserId?: number; alertId?: string; movementId?: string; vehicleId?: number | string };

export type NextStepWorkflow = {
  id: string; title: string;
  kind: "first-watch" | "gate-operation";
  description?: string;
  action: NextStepAction | null;
  message?: string | null;
  context?: GateWorkflowContext | null;
  priority: number;
  savedActions?: NextStepAction[];
};

export type NextStepGroup = { id: string; title: string; workflows: NextStepWorkflow[] };

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
  return groupGateWorkflows([...groups.values()].flatMap(group => group.workflows));
}

export function groupGateWorkflows(workflows: NextStepWorkflow[]): NextStepGroup[] {
  const groups = new Map<string, NextStepGroup>();
  for (const workflow of workflows) {
    const [id, title] = workflow.id === "gate-staffing-recovery" ? ["staffing", "Gate Staffing"]
      : workflow.id === "gate-shift-scheduling" ? ["scheduling", "Gate Scheduling"]
      : workflow.id.includes("vehicle") || workflow.id.includes("inner") || workflow.id.includes("turnaround") ? ["traffic", "Gate Traffic"]
      : ["gate", "Gate Operations"];
    if (!groups.has(id)) groups.set(id, { id, title, workflows: [] });
    groups.get(id)!.workflows.push(workflow);
  }
  for (const group of groups.values()) group.workflows.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return [...groups.values()].sort((a, b) => a.workflows[0].priority - b.workflows[0].priority || a.id.localeCompare(b.id));
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
