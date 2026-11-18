import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileActionButton } from "./gate-profile-chrome";

export type ProfileSetupStep = { id: string; label: string; complete: boolean; optional?: boolean; optionalActionLabel?: string };

export default function ProfileSetupSummary({ steps, loading, onOpen, onKeepOff }: {
  steps: ProfileSetupStep[]; loading: boolean;
  onOpen: (id: string) => void; onKeepOff: (id: string) => void;
}) {
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const complete = steps.filter(step => step.complete).length;
  const next = steps.find(step => !step.complete);
  const allComplete = !loading && steps.length > 0 && complete === steps.length;
  const [reviewExpanded, setReviewExpanded] = useState(false);
  useEffect(() => { if (allComplete) setReviewExpanded(false); }, [allComplete]);
  return <section data-testid="profile-setup-summary" className="rounded-xl border border-[var(--brand-primary)] bg-white/[0.02] p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold">{c("Profile setup", "Configuración del perfil")}</h3>
        <p className="text-sm text-muted-foreground" aria-live="polite">{loading ? c("Loading saved choices…", "Cargando elecciones guardadas…") : c(`${complete} of ${steps.length} complete`, `${complete} de ${steps.length} completados`)}</p>
      </div>
      <ProfileActionButton disabled={loading} aria-expanded={allComplete ? reviewExpanded : undefined} aria-controls={allComplete ? "profile-setup-details" : undefined}
        onClick={() => allComplete ? setReviewExpanded(value => !value) : onOpen(next?.id ?? "language")}>{next ? c("Continue setup", "Continuar configuración") : c("Review setup", "Revisar configuración")}</ProfileActionButton>
    </div>
    {!loading && (!allComplete || reviewExpanded) && <div id="profile-setup-details" className="space-y-3">
      <progress aria-label={c("Profile setup progress", "Progreso de configuración")} className="h-2 w-full" style={{ accentColor: "var(--brand-primary)" }} value={complete} max={steps.length} />
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {steps.map(step => <li key={step.id} className="flex items-center justify-between gap-2 text-sm">
          <button type="button" className="inline-flex min-h-8 min-w-0 items-center gap-2 text-left hover:underline" onClick={() => onOpen(step.id)}>
            {step.complete ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />}
            {step.label}
          </button>
          {step.complete ? <span className="shrink-0 text-xs text-emerald-400">{c("Complete", "Completo")}</span>
            : step.optional ? <button type="button" className="shrink-0 text-xs underline underline-offset-4 text-muted-foreground" onClick={() => onKeepOff(step.id)}>{step.optionalActionLabel ?? c("Keep off", "Mantener desactivado")}</button>
            : <span className="shrink-0 text-xs text-amber-400">{c("Needs review", "Revisar")}</span>}
        </li>)}
      </ul>
      <p className="text-xs text-muted-foreground">{c("An optional setting can stay off and still count as a completed choice.", "Una opción puede permanecer desactivada y contar como una elección completada.")}</p>
    </div>}
  </section>;
}
