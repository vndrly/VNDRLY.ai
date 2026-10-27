import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { commandEnvelope, createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import type { DashboardTask } from "@/lib/dashboard-tasks";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Options = { people: { userId: number; name: string; membershipRole: string; vendorRole: string | null }[] };
type SavedRequest = { path: string; method: string; body: string };
export default function DashboardTaskAssignment({ task }: { task: DashboardTask }) {
  const { user } = useAuth();
  return <TaskAssignment key={`${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${task.id}`} task={task} />;
}
function TaskAssignment({ task }: { task: DashboardTask }) {
  const { user } = useAuth(), { i18n } = useTranslation(), cache = useQueryClient();
  const es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<SavedRequest | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const options = useQuery<Options>({ queryKey: ["work-hub", "task-assignment-options", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, task.id],
    queryFn: () => workHubRequest(`/tasks/${encodeURIComponent(task.id)}/assignment-options`), enabled: open, retry: false, staleTime: 0 });
  if (!user || !task.version || !task.ownerOrgId || !task.ownerOrgType && !task.gateHopper) return null;
  async function send() {
    if (!pending.current || busy) return;
    setBusy(true); setError("");
    try {
      await workHubRequest(pending.current.path, { method: pending.current.method, body: pending.current.body });
      pending.current = null;
      await Promise.all([cache.invalidateQueries({ queryKey: ["work-hub"] }), cache.invalidateQueries({ queryKey: ["gate-task-hopper"] }), cache.invalidateQueries({ queryKey: ["change-over-state"] })]);
      if (mounted.current) setOpen(false);
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status && status < 500) pending.current = null;
      if (status === 409) void cache.invalidateQueries({ queryKey: ["work-hub"] });
      if (mounted.current) setError(caught instanceof Error ? caught.message : c("Assignment was not confirmed.", "No se confirmó la asignación."));
    } finally { if (mounted.current) setBusy(false); }
  }
  function assign(userId: number) {
    if (busy || pending.current) return;
    const operationId = createWorkHubOperationId();
    pending.current = task.gateHopper
      ? { path: "/gate-task-hopper", method: "POST", body: JSON.stringify({ operationId, actorUserId: user!.userId, action: "assign", taskId: task.id, expectedVersion: task.version, assigneeUserId: userId }) }
      : { path: `/tasks/${encodeURIComponent(task.id)}`, method: "PATCH", body: JSON.stringify(commandEnvelope({ type: task.ownerOrgType!, id: task.ownerOrgId! }, { assigneeUserId: userId }, operationId, task.version)) };
    void send();
  }
  const locked = busy || Boolean(pending.current);
  return <span className="hub-task-assignment">
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" disabled={locked} aria-label={`${c("(Re)Assign", "(Re)Asignar")} ${task.title}`}>{c("(Re)Assign", "(Re)Asignar")}</button></PopoverTrigger>
      <PopoverContent align="end" className="hub-task-assignment-flyout" aria-label={c("Assign task to company member", "Asignar tarea a miembro de la empresa")}>
        <strong>{c("Assign to", "Asignar a")}</strong>
        {options.isPending ? <p>{c("Loading people…", "Cargando personas…")}</p> : options.isError ? <p role="alert">{c("People could not load. Close and reopen to retry.", "No se pudieron cargar las personas. Cierre y vuelva a abrir.")}</p> : <div className="hub-task-assignment-people">
          {options.data?.people.map(person => <button type="button" disabled={locked || person.userId === task.assigneeUserId} key={person.userId} onClick={() => assign(person.userId)}>
            <span>{person.name}</span><small>{person.membershipRole === "admin" ? c("Admin", "Administrador") : person.vendorRole?.replaceAll("_", " ") ?? c("Company member", "Miembro de la empresa")}{person.userId === task.assigneeUserId ? ` · ${c("current", "actual")}` : ""}</small>
          </button>)}
          {options.data?.people.length === 0 && <p>{c("No available company members.", "No hay miembros disponibles.")}</p>}
        </div>}
      </PopoverContent>
    </Popover><span aria-hidden="true"> | </span><button type="button" disabled={locked || task.assigneeUserId === user.userId} onClick={() => assign(user.userId)} aria-label={`${c("Assume task", "Asumir tarea")} ${task.title}`}>{c("Assume", "Asumir")}</button>
    {error && <span className="hub-task-assignment-error" role="alert">{error}{pending.current && !busy && <button type="button" onClick={() => void send()}>{c("Retry saved request", "Reintentar solicitud guardada")}</button>}</span>}
  </span>;
}
