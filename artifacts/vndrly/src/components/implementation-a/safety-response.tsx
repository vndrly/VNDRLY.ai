import { useState } from "react";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";
import { ImplementationSurface } from "./surface";

export function SafetyResponse() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(false);
  const [textMode, setTextMode] = useState(false);
  return <ImplementationSurface module="safetyResponse" title="Safety Response" description="Stress-aware incident reporting and acknowledged escalation.">
    <div className="space-y-3">
      {draft ? <div role="status" tabIndex={-1} className="rounded-lg border p-4"><strong>Incident draft ready</strong><p className="text-sm">Ask V will check immediate safety before notifying the configured chain.</p></div> : <BrandPillButton tone="brand" onClick={() => setDraft(true)}>Report an incident</BrandPillButton>}
      <button type="button" className="min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => setTextMode((value) => !value)}>{t("implementationAOperations.textFallback")}</button>
      {textMode ? <label className="block space-y-2 text-sm font-semibold">Describe what happened<textarea autoFocus aria-label="Describe the safety incident by text" className="min-h-28 w-full rounded-lg border bg-background p-3 font-normal" /></label> : null}
    </div>
  </ImplementationSurface>;
}