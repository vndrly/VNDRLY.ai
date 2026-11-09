import { useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ListTodo } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNextSteps } from "./next-steps";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import { parseGateSetupProgressHint, parseGateWorkflowOffer, type GateWorkflowOffer, type GateSetupProgressHint } from "@workspace/gate-booth";
import { registeredGateHelpers, subscribeGateHelpers, gateHelpersRevision, gateHelperDefinition, type GateHelperDefinition, type GateHelperContext, type GateHelperKey } from "@/lib/gate-helper-registry";

const normalized = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export function gateHelperForInstruction(question: string, definitions: GateHelperDefinition[], office: boolean) {
  const text = normalized(question);
  if (!/\b(?:how (?:do|can|should|to)|help me|show me|guide me|teach me|where (?:do|can|is|are)|como|ayudame|guiame|muestrame)\b/.test(text)) return null;
  const matches = definitions.filter(d => (office || d.access !== "office") && (office || d.key !== "first-watch")).map(d => ({ definition: d, score: Math.max(0, ...d.keywords.map(word => text.includes(normalized(word)) ? normalized(word).length : 0)) })).filter(item => item.score > 0);
  matches.sort((a, b) => b.score - a.score || a.definition.key.localeCompare(b.definition.key));
  return matches[0]?.definition ?? null;
}
function pageContext(): GateHelperContext {
  const params = new URLSearchParams(window.location.search); const result: GateHelperContext = {};
  const site = Number(params.get("siteId")); if (Number.isSafeInteger(site) && site > 0) result.siteId = site;
  const vehicle = Number(params.get("vehicleId")); if (Number.isSafeInteger(vehicle) && vehicle > 0) result.vehicleId = vehicle;
  for (const key of ["stationId", "shiftId", "alertId", "movementId"] as const) { const value = params.get(key); if (value && /^[a-f0-9-]{36}$/i.test(value)) result[key] = value; }
  const day = params.get("date") ?? params.get("day"); if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) result.day = day;
  return result;
}
type SetupProgress = { state: "actionable" | "waiting" | "complete" | "unavailable" };
function savedSetupProgress(calls: Array<{ name: string; output: string }>): SetupProgress | null {
  const output = calls.filter(call => call.name === "query_gate_setup_progress").at(-1)?.output;
  if (!output) return null;
  try {
    const result = JSON.parse(output);
    return result.kind === "gate_setup_progress" && result.workflowKey === "first-watch" && ["actionable", "waiting", "complete", "unavailable"].includes(result.state) ? result : null;
  } catch { return null; }
}

/** askV offers the same workflow and saved resume point that Next Steps renders. */
export function AskVGateHelperOffer({ question, workflowOffer, setupProgress, toolCalls = [], onStarted }: { question: string; workflowOffer?: GateWorkflowOffer; setupProgress?: GateSetupProgressHint; toolCalls?: Array<{ name: string; output: string }>; onStarted?: () => void }) {
  const next = useNextSteps(); const { user } = useAuth(); const { i18n } = useTranslation(); const [location] = useLocation();
  useSyncExternalStore(subscribeGateHelpers, gateHelpersRevision, gateHelpersRevision);
  const scopeRef = useRef(next?.scope); scopeRef.current = next?.scope;
  const [result, setResult] = useState<{ identity: string; status: "started" | "complete" | "unavailable" | "busy" | "checking" } | null>(null);
  if (!next?.enabled || !user || !question.trim() && !next.selected) return null;
  const office = canUseOfficeNavigation(user);
  const text = normalized(question);
  const resumeQuestion = /\b(?:what (?:should i do |do i do |is |s )?next|where (?:am i|was i)|resume|continue (?:my |this |the )?(?:workflow|setup|next step)|siguiente paso|continuar|reanudar)\b/.test(text);
  const currentStepQuestion = /\b(?:this (?:step|button|control|form)|what does (?:this|that) mean|why (?:can t|cant|is|won t)|este (?:paso|boton|formulario))\b/.test(text);
  const progress = parseGateSetupProgressHint(setupProgress) ?? savedSetupProgress(toolCalls);
  const offer = parseGateWorkflowOffer(workflowOffer, user.vendorId ?? null);
  const specific = gateHelperForInstruction(question, registeredGateHelpers(), office);
  const unrelated = !specific && !offer && /\b(?:payroll|invoice|taxes|certifications?|fleet|profile|nomina|factura)\b/.test(text);
  if (unrelated) return null;
  const contextualKey = next.selected && (resumeQuestion || currentStepQuestion || !question.trim()) ? next.selected.id
    : resumeQuestion ? next.assistantContext?.available[0]?.key : null;
  const fromTool = progress && ["actionable", "waiting"].includes(progress.state) ? "first-watch" : null;
  const definition = offer ? gateHelperDefinition(offer.workflowKey) : specific ?? gateHelperDefinition((contextualKey ?? fromTool) as GateHelperKey);
  if (!definition || definition.access === "office" && !office) return null;
  if (definition.key === "first-watch" && progress && ["complete", "unavailable"].includes(progress.state) && next.selected?.id !== definition.key) return null;
  const active = next.selected?.id === definition.key ? next.selected : null;
  const saved = active ?? next.assistantContext?.available.find(item => item.key === definition.key);
  const employeeRequest = /\b(?:add (?:an? )?(?:employee|gatekeeper)|agregar empleado)\b/.test(text);
  const resume = Boolean(active || definition.key === "first-watch" && !employeeRequest && (offer || progress || resumeQuestion || /first gate watch|primera guardia/.test(text)));
  const identity = JSON.stringify([next.scope, question, definition.key]); const current = result?.identity === identity ? result : null;
  const busyWithOther = Boolean(next.selected && (next.selected.id !== definition.key || offer && Object.entries(offer.context).some(([key, value]) => ["siteId", "stationId", "shiftId", "vehicleId", "alertId"].includes(key) && String(next.selected?.context?.[key as keyof GateHelperContext]) !== String(value))));
  const es = i18n.language?.startsWith("es");
  return <section className="rounded-xl border-2 p-3 text-sm" style={{ borderColor: "var(--brand-primary)", background: "#ffffff", color: "#111827" }} aria-label={es ? "Ayuda guiada de Gate" : "Gate guided helper offer"} data-testid="askv-gate-helper-offer">
    <strong className="flex items-center gap-2"><ListTodo className="h-4 w-4" aria-hidden="true" />{saved?.title ?? definition.title}</strong>
    <p className="mt-1">{es ? "Continuamos juntos en Next Steps. Conservo el contexto de este paso para responder tus preguntas mientras trabajas." : "We can continue together in Next Steps. I keep this step’s context so you can ask questions as you work."}</p>
    {saved?.action && <p className="mt-1"><strong>{es ? "Paso actual: " : "Current step: "}</strong>{saved.action.title}</p>}
    {saved?.message && <p className="mt-1">{saved.message}</p>}
    <button className="vendor-mini-card-button mt-2" type="button" disabled={busyWithOther || current?.status === "started" || current?.status === "checking"} onClick={async () => {
      const scope = next.scope;
      setResult({ identity, status: "checking" });
      let status: "started" | "complete" | "unavailable" | "busy";
      try {
        status = resume && next.resumeHelper ? await next.resumeHelper(definition.key)
          : next.startHelper(definition.key, active?.context ?? offer?.context ?? pageContext()) ? "started" : "unavailable";
      } catch { status = "unavailable"; }
      if (scopeRef.current !== scope) return;
      setResult({ identity, status });
      if (status === "started") onStarted?.();
    }} data-page={location}>{current?.status === "started" ? (es ? "Ayuda iniciada" : "Helper started") : current?.status === "checking" ? (es ? "Revisando progreso guardado…" : "Checking saved progress…") : resume ? (es ? "Continuar en Next Steps" : "Resume in Next Steps") : (es ? "Iniciar ayuda guiada" : "Start guided helper")}</button>
    {busyWithOther && <p role="status">{es ? "Termina o cierra tu ayuda actual antes de iniciar otra." : "Finish or close your current helper before starting another."}</p>}
    {current?.status === "complete" && <p role="status">{es ? "Este flujo ya está completo en los registros guardados." : "Saved records confirm this workflow is already complete."}</p>}
    {current?.status === "unavailable" && !busyWithOther && <p role="status">{es ? "La ayuda no está disponible con tu acceso actual." : "This helper is unavailable with your current access."}</p>}
    {current?.status === "busy" && !busyWithOther && <p role="status">{es ? "Otro flujo está activo. Continúa o ciérralo primero." : "Another workflow is now active. Continue or close it first."}</p>}
  </section>;
}
