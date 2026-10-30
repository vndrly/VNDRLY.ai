import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBrand } from "@/hooks/use-brand";
import { BrandedSelect } from "./chrome";
import Picker from "./calendar-assignee-picker";
import { FormattedDateTimeInput, parseTaskDateTime } from "./formatted-date-time-input";
import { commandEnvelope, workHubRequest } from "@/lib/work-hub-client";
import "./calendar-create-cards.css";

type Row = Record<string, any>;
type Owner = { type: "vendor" | "partner"; id: number };
const emptyTask = () => ({ title: "", description: "", dueAt: "", priority: "normal", userIds: [] as number[], crewIds: [] as string[] });

export default function CalendarTaskFlyout({ owner, canAssign }: { owner: Owner; canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState(emptyTask);
  const qc = useQueryClient(), brand = useBrand();
  const people = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-people", owner], queryFn: () => workHubRequest("/people"), enabled: open && canAssign });
  const crews = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-crews", owner], queryFn: () => workHubRequest("/crews"), enabled: open && canAssign });
  const createTask = useMutation({
    mutationFn: async () => {
      const due = task.dueAt ? parseTaskDateTime(task.dueAt) : null;
      if (task.dueAt && !due) throw new Error("Use MM/DD/YY hh:mm AM/PM for the due date.");
      const members = canAssign ? await Promise.all(task.crewIds.map(id => workHubRequest(`/crews/${id}/members`) as Promise<Row[]>)) : [];
      const assignees = canAssign ? [...new Set([...task.userIds, ...members.flat().map(member => Number(member.userId)).filter(Boolean)])] : [];
      // No assignee creates one company hopper task; an on-shift person remains assignable.
      const targets = assignees.length ? assignees : [null];
      await Promise.all(targets.map(assigneeUserId => workHubRequest("/tasks", {
        method: "POST", body: JSON.stringify(commandEnvelope(owner, {
          title: task.title.trim(), description: task.description, dueAt: due?.toISOString() ?? null,
          priority: task.priority, assigneeUserId,
        })),
      })));
    },
    onSuccess: () => {
      setOpen(false); setTask(emptyTask());
      for (const key of ["calendar", "tasks", "dashboard-tasks", "home"]) void qc.invalidateQueries({ queryKey: ["work-hub", key] });
    },
  });
  const close = () => { if (!createTask.isPending) { setOpen(false); setTask(emptyTask()); createTask.reset(); } };
  return <>
    <button type="button" className="hub-task-mini-card" onClick={() => setOpen(true)}><CheckSquare2 size={16} aria-hidden="true" />Add Task</button>
    <Dialog open={open} onOpenChange={value => value ? setOpen(true) : close()}>
      <VendorEditFlyout title="Add Task" logoSrc={brand.logoSquareUrl || brand.logoUrl || undefined} logoAlt={`${brand.name} logo`} onClose={close}>
        <form aria-label="Create Task" className="hub-schedule-form hub-task-flyout-form grid gap-3" onSubmit={event => { event.preventDefault(); createTask.mutate(); }}>
          <label className="grid gap-1">Title<Input required maxLength={200} value={task.title} onChange={event => setTask({ ...task, title: event.target.value })} /></label>
          <label className="grid gap-1">Description<Textarea maxLength={20000} value={task.description} onChange={event => setTask({ ...task, description: event.target.value })} /></label>
          <div className="hub-schedule-fields">
            <label className="grid gap-1">Due (optional)<FormattedDateTimeInput value={task.dueAt} onChange={event => setTask({ ...task, dueAt: event.target.value })} /></label>
            <label className="grid gap-1">Priority<BrandedSelect value={task.priority} onChange={event => setTask({ ...task, priority: event.target.value })}>{["low", "normal", "high", "urgent"].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</BrandedSelect></label>
          </div>
          <p className="hub-task-flyout-hint">{canAssign ? "Assignment is optional. Leave crews and individuals unselected to add this task to the Unassigned Task Hopper." : "Your task will be added to the Unassigned Task Hopper for your company."}</p>
          {canAssign && <details className="hub-task-assignees"><summary>Assign crew or individuals (optional)</summary>
            {people.isError || crews.isError ? <p role="alert">Assignments could not load. You can still add this task unassigned.</p> : <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={task.userIds} crewIds={task.crewIds} onUsers={userIds => setTask({ ...task, userIds })} onCrews={crewIds => setTask({ ...task, crewIds })} />}
          </details>}
          {createTask.error && <p role="alert">{createTask.error instanceof Error ? createTask.error.message : "Unable to create task."}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="vendor-mini-card-button" disabled={createTask.isPending} onClick={close}>Cancel</button><button type="submit" className="vendor-mini-card-button" disabled={createTask.isPending || !task.title.trim()}>{createTask.isPending ? "Adding…" : "Add Task"}</button></div>
        </form>
      </VendorEditFlyout>
    </Dialog>
  </>;
}
