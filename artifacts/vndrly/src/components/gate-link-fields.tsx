import { BrandedInput, BrandedSelect } from "./work-hub/chrome";
import { useTranslation } from "react-i18next";

export type LinkSite = { id: number; name: string; partnerId?: number; gateLinkId?: string | null; gateLinkName?: string | null };
export type GateLinkDraft = { mode: "none" | "new" | "existing"; name: string; targetSiteId: string };
export const emptyGateLink: GateLinkDraft = { mode: "none", name: "", targetSiteId: "" };
export function gateLinkPayload(value: GateLinkDraft) {
  return value.mode === "none" ? undefined : value.mode === "existing" ? { targetSiteId: Number(value.targetSiteId) } : { name: value.name.trim() };
}
export default function GateLinkFields({ value, onChange, sites, siteId, partnerId, disabled = false }: {
  value: GateLinkDraft; onChange: (value: GateLinkDraft) => void; sites: LinkSite[]; siteId?: number; partnerId?: number; disabled?: boolean;
}) {
  const { i18n } = useTranslation(), es = i18n?.language?.startsWith("es");
  const candidates = sites.filter(site => site.id !== siteId && (!partnerId || site.partnerId === partnerId));
  return <div className="grid min-w-0 gap-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="gate-history-filter" disabled={disabled} aria-pressed={value.mode === "new"} onClick={() => onChange({...value,mode:value.mode === "new" ? "none" : "new"})}>{es ? "+ Agregar acceso vinculado" : "+ Add linked gate"}</button>
      <button type="button" className="gate-history-filter" disabled={disabled || !candidates.length} aria-pressed={value.mode === "existing"} onClick={() => onChange({...value,mode:value.mode === "existing" ? "none" : "existing"})}>{es ? "+ Agregar a vínculo existente" : "+ Add to existing link"}</button>
    </div>
    {value.mode === "new" && <label className="grid gap-1 text-sm">{es ? "Nombre del sitio / ramal" : "Site / Spur link name"}<BrandedInput required maxLength={100} disabled={disabled} value={value.name} onChange={e => onChange({...value,name:e.target.value})}/></label>}
    {value.mode === "existing" && <label className="grid gap-1 text-sm">{es ? "Elegir sitio / ramal" : "Choose Site / Spur"}<BrandedSelect required disabled={disabled} value={value.targetSiteId} onChange={e => onChange({...value,targetSiteId:e.target.value})}><option value="">{es ? "Elegir" : "Choose"}</option>{candidates.map(site => <option key={site.id} value={site.id}>{site.gateLinkName ? `${site.gateLinkName} | ${site.name}` : site.name}</option>)}</BrandedSelect></label>}
  </div>;
}
