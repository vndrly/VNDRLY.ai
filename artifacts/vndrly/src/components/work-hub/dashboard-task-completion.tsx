import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { commandEnvelope, createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import type { DashboardTask } from "@/lib/dashboard-tasks";
import { useGateHopperOptions } from "@/components/gate-task-hopper";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PngPillButton } from "@/components/png-pill-rollover";

export default function DashboardTaskCompletion({ task }: { task: DashboardTask }) {
  const { user } = useAuth();
  return <Completion key={`${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${task.id}`} task={task} />;
}
function Completion({ task }: { task: DashboardTask }) {
  const { user } = useAuth(), { i18n } = useTranslation(), cache = useQueryClient();
  const es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState(false), [resolution, setResolution] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saved = useRef<{ path: string; method: string; body: string } | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const completed = task.status === "completed";
  const options = useGateHopperOptions(open && Boolean(task.gateHopper) && !completed, task.id);
  if (!user || !task.version || !task.ownerOrgId || !task.ownerOrgType && !task.gateHopper || task.status === "cancelled") return null;
  async function send() {
    if (!saved.current || busy) return;
    setBusy(true); setError("");
    try {
      await workHubRequest(saved.current.path, { method: saved.current.method, body: saved.current.body });
      saved.current = null;
      await Promise.all([cache.invalidateQueries({ queryKey: ["work-hub"] }), cache.invalidateQueries({ queryKey: ["gate-task-hopper"] }), cache.invalidateQueries({ queryKey: ["change-over-state"] })]);
      if (mounted.current) { setOpen(false); setResolution(""); }
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status && status < 500) saved.current = null;
      if (status === 409) void cache.invalidateQueries({ queryKey: ["work-hub"] });
      if (mounted.current) setError(caught instanceof Error ? caught.message : c("Completion was not confirmed.", "No se confirmó la finalización."));
    } finally { if (mounted.current) setBusy(false); }
  }
  function complete() {
    if (busy || saved.current || !resolution.trim()) return;
    const operationId = createWorkHubOperationId();
    saved.current = task.gateHopper
      ? { path: "/gate-task-hopper", method: "POST", body: JSON.stringify({ operationId, actorUserId: user!.userId, action: "complete", taskId: task.id, expectedVersion: task.version, note: resolution.trim() }) }
      : { path: `/tasks/${encodeURIComponent(task.id)}`, method: "PATCH", body: JSON.stringify(commandEnvelope({ type: task.ownerOrgType!, id: task.ownerOrgId! }, { action: "complete", resolution: resolution.trim() }, operationId, task.version)) };
    void send();
  }
  const locked = busy || Boolean(saved.current), allowed = !task.gateHopper || options.data?.canComplete;
  return <span className="hub-task-completion"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <button type="button" role="switch" aria-checked={completed} aria-label={`${c("Completed", "Completada")}: ${task.title}`} disabled={busy} className={`hub-task-complete-control${completed ? " is-complete" : ""}`}>
      <span>{c("Completed", "Completada")}</span><span className="hub-task-complete-line" aria-hidden="true"><span /></span>
    </button>
  </PopoverTrigger><PopoverContent align="end" className="hub-task-assignment-flyout hub-task-resolution" aria-label={c("Task resolution", "Resolución de tarea")}>
    {completed ? <><strong>{c("Resolution", "Resolución")}</strong><p>{task.gateHopper?.completionNote ?? task.completionResolution ?? c("No resolution was recorded for this earlier task.", "No se registró una resolución para esta tarea anterior.")}</p></> : <form onSubmit={event => { event.preventDefault(); complete(); }}>
      <label>{c("Resolution", "Resolución")}<textarea aria-label={c("Resolution", "Resolución")} rows={3} maxLength={2000} required value={resolution} disabled={locked} onChange={event => setResolution(event.target.value)} placeholder={c("What was done to resolve this task?", "¿Qué se hizo para resolver esta tarea?")} /></label>
      {task.gateHopper && !options.isPending && !allowed && <p>{options.isError ? c("Your shift could not be verified.", "No se pudo verificar su turno.") : c("Start your shift to complete hopper tasks.", "Inicie su turno para completar tareas de la bandeja.")}</p>}
      {error && <p role="alert">{error}</p>}
      {saved.current && !busy ? <PngPillButton type="button" onClick={() => void send()}>{c("Retry saved completion", "Reintentar finalización guardada")}</PngPillButton> : <PngPillButton type="submit" disabled={locked || !allowed || !resolution.trim()}>{c("Save resolution & complete", "Guardar resolución y completar")}</PngPillButton>}
    </form>}
  </PopoverContent></Popover></span>;
}
