import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import "./gate-task-hopper.css";

export type GateHopperTask = { id: string; title: string; description?: string | null; status: string; ownerOrgId: number; assigneeUserId: number | null;
  assigneeName?: string | null; createdById: number; createdAt: string; version: number; siteName?: string; gateName?: string; completedByName?: string | null;
  gateHopper: { stationId: string; siteId: number; completedById?: number; completedAt?: string; completionNote?: string; clearedAt?: string } };
type Options = { gates: { stationId: string; siteId: number; siteName: string; gateName: string; vendorId: number; vendorName: string }[];
  people: { userId: number; name: string; vendorId: number }[]; canManage: boolean; canComplete: boolean };
type LegacyItem = { id: string; stationId: string; text: string; createdAt: string; siteName: string; gateName: string };
type Page = { tasks: GateHopperTask[]; unimported?: LegacyItem[]; canManage: boolean; total: number; nextBefore: string | null };
type Command = { operationId: string; action: "create" | "import" | "complete" | "assign" | "clear" | "delete"; taskId?: string; expectedVersion?: number; text?: string; note?: string; stationId?: string; vendorId?: number; assigneeUserId?: number | null };
export function useGateHopperOptions(enabled = true, taskId?: string) {
  const { user } = useAuth();
  return useQuery<Options>({ queryKey: ["gate-task-hopper-options", user?.userId, user?.activeMembershipId, taskId], queryFn: () => workHubRequest(`/gate-task-hopper/options${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`), enabled: Boolean(user) && enabled, retry: false, refetchInterval: 15000 });
}
export default function GateTaskHopper({ stationId, collapsed = false, taskId, allowCreate = true, showTitle = true }: { stationId?: string; collapsed?: boolean; taskId?: string; allowCreate?: boolean; showTitle?: boolean }) {
  const { user } = useAuth(), { i18n } = useTranslation(), cache = useQueryClient();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  // Server options recognize current normalized gate roles as well as legacy roles.
  const eligible = Boolean(user && (user.role === "admin" || user.vendorId));
  const [before, setBefore] = useState<string | null>(null), [all, setAll] = useState<GateHopperTask[]>([]), [text, setText] = useState(""), [gate, setGate] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<Command | null>(null);
  const options = useGateHopperOptions(eligible, taskId);
  const query = new URLSearchParams({ ...(stationId ? { stationId } : {}), ...(taskId ? { taskId } : {}), ...(before ? { before } : {}) });
  const tasks = useQuery<Page>({ queryKey: ["gate-task-hopper", user?.userId, user?.activeMembershipId, stationId, taskId, before], queryFn: () => workHubRequest(`/gate-task-hopper?${query}`), enabled: eligible, retry: false, refetchInterval: before ? false : 15000 });
  useEffect(() => { setBefore(null); setAll([]); setGate(""); setError(""); pending.current = null; }, [user?.userId, user?.activeMembershipId, stationId, taskId]);
  useEffect(() => { if (tasks.data) setAll(prior => before ? [...prior.filter(item => !tasks.data!.tasks.some(next => next.id === item.id)), ...tasks.data!.tasks] : tasks.data!.tasks); }, [tasks.data, before]);
  const gates = options.data?.gates.filter(item => !stationId || item.stationId === stationId) ?? [];
  const selected = gates.find(item => `${item.vendorId}:${item.stationId}` === gate) ?? (gates.length === 1 ? gates[0] : undefined);
  const perform = async (command: Omit<Command, "operationId">) => {
    if (busy || pending.current) return;
    pending.current = { operationId: crypto.randomUUID(), ...command }; await sendPending();
  };
  async function sendPending() {
    if (busy || !pending.current) return; setBusy(true); setError("");
    try {
      await workHubRequest("/gate-task-hopper", { method: "POST", body: JSON.stringify(pending.current) }); pending.current = null; setText(""); setBefore(null);
      await Promise.all([cache.invalidateQueries({ queryKey: ["gate-task-hopper"] }), cache.invalidateQueries({ queryKey: ["work-hub"] }), cache.invalidateQueries({ queryKey: ["change-over-state"] })]);
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status && status < 500) pending.current = null;
      if (status === 409) void cache.invalidateQueries({ queryKey: ["gate-task-hopper"] });
      setError(caught instanceof Error ? caught.message : c("Task change could not be verified", "No se pudo verificar el cambio"));
    } finally { setBusy(false); }
  }
  if (!eligible || options.isError && (options.error as { status?: number }).status === 403) return null;
  const content = <div className="gate-hopper-body">
    {tasks.isError && <p role="alert">{c("Task records could not load.", "No se pudieron cargar las tareas.")}</p>}
    {tasks.isPending && <p role="status">{c("Loading tasks…", "Cargando tareas…")}</p>}
    {all.map(task => <GateTaskRecord key={task.id} task={task} options={options.data} busy={busy || Boolean(pending.current)} onAction={perform} />)}
    {tasks.data?.unimported?.map(item => <LegacyGateTask key={item.id} item={item} options={options.data} busy={busy || Boolean(pending.current)} onAction={perform} />)}
    {!tasks.isPending && !tasks.isError && !all.length && <p className="handoff-muted">{c("No unassigned tasks.", "No hay tareas sin asignar.")}</p>}
    {tasks.data?.nextBefore && <TogglePillButton color="brand" onClick={() => setBefore(tasks.data!.nextBefore)}>{c("More tasks", "Más tareas")}</TogglePillButton>}
    {allowCreate && !taskId && <form className="gate-hopper-add" onSubmit={event => { event.preventDefault(); if (selected && text.trim()) void perform({ action: "create", stationId: selected.stationId, vendorId: selected.vendorId, text: text.trim() }); }}>
      {gates.length !== 1 && <select aria-label={c("Task gate", "Acceso de la tarea")} value={gate} disabled={busy || Boolean(pending.current)} onChange={event => setGate(event.target.value)}>
        <option value="">{c("Choose site and gate", "Elegir sitio y acceso")}</option>{gates.map(item => <option key={`${item.vendorId}:${item.stationId}`} value={`${item.vendorId}:${item.stationId}`}>{item.siteName} · {item.gateName}{user?.role === "admin" ? ` · ${item.vendorName}` : ""}</option>)}
      </select>}
      <textarea aria-label={c("Unassigned task", "Tarea sin asignar")} placeholder={c("What needs doing?", "¿Qué se necesita hacer?")} value={text} maxLength={2000} rows={2} disabled={busy || Boolean(pending.current)} onChange={event => setText(event.target.value)} />
      <TogglePillButton color="brand" type="submit" disabled={!selected || !text.trim() || busy || Boolean(pending.current) || !options.data?.canManage && !options.data?.canComplete}>{c("Add task", "Añadir tarea")}</TogglePillButton>
    </form>}
    {error && <p role="alert">{error}</p>}
    {pending.current && !busy && <TogglePillButton color="blue" onClick={() => void sendPending()}>{c("Check / retry saved request", "Comprobar / reintentar solicitud")}</TogglePillButton>}
  </div>;
  return collapsed ? <details className="gate-panel-disclosure gate-task-hopper"><summary><ClipboardList aria-hidden="true" /><span>{c("Unassigned Tasks", "Tareas sin asignar")}</span><small>{tasks.isError ? "—" : tasks.data?.total ?? "…"}</small></summary>{content}</details>
    : <section className="gate-task-hopper" aria-label={c("Unassigned Task Hopper", "Bandeja de tareas sin asignar")}>{showTitle && <h3 className="gate-hopper-title"><ClipboardList aria-hidden="true" />{taskId ? c("Gate task record", "Registro de tarea de acceso") : c("Unassigned Task Hopper", "Bandeja de tareas sin asignar")}</h3>}{content}</section>;
}
function LegacyGateTask({ item, options, busy, onAction }: { item: LegacyItem; options?: Options; busy: boolean; onAction: (command: Omit<Command, "operationId">) => Promise<void> }) {
  const [vendor, setVendor] = useState("");
  const { i18n } = useTranslation(), es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const gates = options?.gates.filter(gate => gate.stationId === item.stationId) ?? [], selected = gates.find(gate => String(gate.vendorId) === vendor);
  return <details className="gate-hopper-task"><summary><span>{item.text}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></summary><div className="gate-hopper-task-detail">
    <p>{item.siteName} · {item.gateName}</p><p>{c("Original action retained. Office must select its vendor before it enters the task hopper.", "Acción original conservada. Oficina debe elegir su proveedor para incorporarla a la bandeja.")}</p>
    {options?.canManage && <><select aria-label={c("Original task vendor", "Proveedor de la tarea original")} value={vendor} onChange={event => setVendor(event.target.value)} disabled={busy}><option value="">{c("Choose vendor", "Elegir proveedor")}</option>{gates.map(gate => <option key={gate.vendorId} value={gate.vendorId}>{gate.vendorName}</option>)}</select><TogglePillButton color="blue" disabled={busy || !selected} onClick={() => void onAction({ action: "import", taskId: item.id, stationId: item.stationId, vendorId: selected!.vendorId })}>{c("Add original to hopper", "Añadir original a la bandeja")}</TogglePillButton></>}
  </div></details>;
}
function GateTaskRecord({ task, options, busy, onAction }: { task: GateHopperTask; options?: Options; busy: boolean; onAction: (command: Omit<Command, "operationId">) => Promise<void> }) {
  const { i18n } = useTranslation(), { user } = useAuth(), es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [note, setNote] = useState(""), [assignee, setAssignee] = useState(String(task.assigneeUserId ?? ""));
  const open = ["open", "in_progress"].includes(task.status) && !task.gateHopper.clearedAt;
  return <details className="gate-hopper-task" open={new URLSearchParams(window.location.search).get("task") === task.id}>
    <summary><span>{task.title}</span><time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString()}</time></summary>
    <div className="gate-hopper-task-detail">
      <p>{task.description}</p><p className="handoff-muted">{task.siteName} · {task.gateName}{task.assigneeUserId ? ` · ${task.assigneeName ?? `${c("Employee", "Empleado")} ${task.assigneeUserId}`}` : ""}</p>
      <a href={`/work-hub/tasks?task=${task.id}`}>{c("Open task record", "Abrir registro")}</a>
      {task.gateHopper.completedAt && <p>{c("Completed", "Completada")} · {task.completedByName ?? `${c("Employee", "Empleado")} ${task.gateHopper.completedById}`} · <time dateTime={task.gateHopper.completedAt}>{new Date(task.gateHopper.completedAt).toLocaleString()}</time><br />{task.gateHopper.completionNote}</p>}
      {task.gateHopper.clearedAt && <p>{c("Removed from hopper; history retained.", "Retirada de la bandeja; historial conservado.")}</p>}
      {open && <>
        <textarea aria-label={c("Completion note", "Nota de finalización")} value={note} maxLength={2000} rows={2} placeholder={c("What was done?", "¿Qué se hizo?")} disabled={busy} onChange={event => setNote(event.target.value)} />
        <TogglePillButton color="green" disabled={busy || !options?.canComplete || !note.trim() || Boolean(task.assigneeUserId && task.assigneeUserId !== user?.userId && !options?.canManage)} onClick={() => void onAction({ action: "complete", taskId: task.id, expectedVersion: task.version, note: note.trim() })}>{c("Complete task", "Completar tarea")}</TogglePillButton>
        {!options?.canComplete && <p className="handoff-muted">{c("Completion is available while on shift.", "Se puede completar durante el turno.")}</p>}
        {options?.canManage && <div className="gate-hopper-admin">
          <select aria-label={c("Assign task to", "Asignar tarea a")} value={assignee} disabled={busy} onChange={event => setAssignee(event.target.value)}><option value="">{c("Leave unassigned", "Dejar sin asignar")}</option>{options.people.filter(person => person.vendorId === task.ownerOrgId).map(person => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select>
          <TogglePillButton color="blue" disabled={busy} onClick={() => void onAction({ action: "assign", taskId: task.id, expectedVersion: task.version, assigneeUserId: assignee ? Number(assignee) : null })}>{c("Assign", "Asignar")}</TogglePillButton>
          {!task.assigneeUserId && <><TogglePillButton color="amber" disabled={busy} onClick={() => void onAction({ action: "clear", taskId: task.id, expectedVersion: task.version })}>{c("Clear", "Retirar")}</TogglePillButton><TogglePillButton color="red" disabled={busy} onClick={() => void onAction({ action: "delete", taskId: task.id, expectedVersion: task.version })}>{c("Delete", "Eliminar")}</TogglePillButton></>}
        </div>}
      </>}
    </div>
  </details>;
}
