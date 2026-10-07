import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";

export function isWorkPlanDescription(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 20000) return false;
  try { const plan = JSON.parse(value); return plan.schemaVersion === 1 && typeof plan.id === "string" && Array.isArray(plan.steps); } catch { return false; }
}
type Projection = { taskId: string; taskVersion: number; verifiedCompletionStepIds: string[]; eligibleStepIds: string[]; overdueStepIds: string[]; executionStarted: false; backgroundExecutionAvailable: false; plan: { steps: { id: string; specialist: string; state: string; dependsOn: string[]; deadlineAt?: string; detail?: string; completion?: { kind: string } }[] } };
export function WorkPlanDetail({ taskId, taskVersion, identity }: { taskId: string; taskVersion: number; identity: string }) {
  const [opened, setOpened] = useState(false);
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  const query = useQuery({
    queryKey: ["work-plan", identity, taskId, taskVersion], enabled: opened, retry: false, staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/work-hub/tasks/${encodeURIComponent(taskId)}/plan`, { credentials: "include", cache: "no-store", signal });
      if (!response.ok) throw Error("Plan unavailable");
      const result = await response.json() as Projection;
      if (result.taskId !== taskId || result.taskVersion !== taskVersion || result.executionStarted !== false || result.backgroundExecutionAvailable !== false || !Array.isArray(result.plan?.steps)) throw Error("Plan changed");
      return result;
    },
  });
  return <div className="space-y-2">
    <BrandPillButton tone="brand" onClick={() => { setOpened(true); if (opened) void query.refetch(); }}>{es ? "Ver plan guardado" : "View saved plan"}</BrandPillButton>
    {opened && <p className="text-sm">{es ? "Los plazos son informativos. Este plan no ejecuta tareas en segundo plano. Continúe con V en la cuenta y empresa actuales; los cambios requieren su autorización existente." : "Deadlines are informational. This plan does not execute work in the background. Continue with V in the current account and company; changes require existing authorization."}</p>}
    {opened && query.isPending && <p role="status">{es ? "Consultando plan…" : "Reading plan…"}</p>}
    {opened && query.isError && <p role="alert">{es ? "El plan cambió o su acceso ya no está disponible. Actualice las tareas." : "The plan changed or access is unavailable. Refresh tasks."}</p>}
    {opened && !query.isError && query.data?.plan.steps.map(step => <article key={step.id} className="rounded border p-3 text-sm">
      <p className="font-semibold">{step.id} · {step.specialist}</p>
      <p>{es ? "Estado registrado" : "Recorded state"}: {step.state}</p>
      <p>{query.data!.verifiedCompletionStepIds.includes(step.id) ? (es ? "Evidencia histórica verificada; no otorga acceso nuevo." : "Historical evidence verified; grants no new access.") : step.state === "completed" ? (es ? "Finalización registrada sin evidencia verificada." : "Recorded completion has no verified evidence.") : query.data!.eligibleStepIds.includes(step.id) ? (es ? "Disponible con los permisos actuales." : "Available under current permissions.") : (es ? "En espera o no disponible con los permisos actuales." : "Waiting or unavailable under current permissions.")}</p>
      {step.dependsOn.length > 0 && <p>{es ? "Requisitos previos" : "Prerequisites"}: {step.dependsOn.join(", ")}</p>}
      {step.deadlineAt && <p>{es ? "Plazo informado" : "Informational deadline"}: {step.deadlineAt}{query.data!.overdueStepIds.includes(step.id) ? (es ? " · vencido" : " · overdue") : ""}</p>}
      {step.completion?.kind === "planned_read_observed" && <p>{es ? "Solo observaciones de consultas; no confirma trabajo operativo." : "Read observations only; does not confirm operational work."}</p>}
      {step.detail && <p className="whitespace-pre-wrap">{step.detail}</p>}
    </article>)}
  </div>;
}
