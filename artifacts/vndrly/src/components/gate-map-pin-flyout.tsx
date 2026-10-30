import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useBrand } from "@/hooks/use-brand";
import { VendorEditFlyout } from "./vendor-edit-flyout";
import { BrandedInput, BrandedSelect } from "./work-hub/chrome";
import { PngPillButton } from "./png-pill-rollover";
import { changeOverRequest } from "@/lib/change-over-api";

export type GateMapPin = { id: string; siteId: number; label: string; notes: string; latitude: number; longitude: number; createdAt: string; createdById: number };
export function GateMapPinFlyout({ latitude, longitude, siteId, sites, es, onClose, onSaved }: {
  latitude: number; longitude: number; siteId: number; sites: { id: number; name: string }[]; es: boolean;
  onClose: () => void; onSaved: (pin: GateMapPin) => void;
}) {
  const brand = useBrand(), t = (en: string, spanish: string) => es ? spanish : en;
  const [id] = useState(() => crypto.randomUUID());
  const [label, setLabel] = useState(""), [notes, setNotes] = useState("");
  const [site, setSite] = useState(siteId), [lat, setLat] = useState(latitude.toFixed(6)), [lng, setLng] = useState(longitude.toFixed(6));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try {
      const result = await changeOverRequest<{ pin: GateMapPin }>("/map-pins", { id, siteId: site, label, notes, latitude: Number(lat), longitude: Number(lng) });
      onSaved(result.pin);
    } catch (err) { setError(err instanceof Error ? err.message : t("Pin could not be saved", "No se pudo guardar el pin")); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose(); }}><VendorEditFlyout title={t("Drop Pin", "Agregar pin")} logoSrc={brand.logoSquareUrl || brand.logoUrl || undefined} logoAlt={`${brand.name} logo`} className="gate-map-pin-flyout" onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={save} className="gate-map-pin-form">
      <label>{t("Label", "Nombre")}<BrandedInput required maxLength={100} value={label} onChange={event => setLabel(event.target.value)} autoFocus disabled={saving} /></label>
      <label>{t("Site", "Sitio")}<BrandedSelect value={site} onChange={event => setSite(Number(event.target.value))} disabled={saving}>{sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</BrandedSelect></label>
      <div className="gate-map-pin-coordinates"><label>{t("Latitude", "Latitud")}<BrandedInput required type="number" step="any" min={-90} max={90} value={lat} onChange={event => setLat(event.target.value)} disabled={saving} /></label><label>{t("Longitude", "Longitud")}<BrandedInput required type="number" step="any" min={-180} max={180} value={lng} onChange={event => setLng(event.target.value)} disabled={saving} /></label></div>
      <label>{t("Details", "Detalles")}<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} disabled={saving} rows={3} /></label>
      <p className="text-xs text-muted-foreground">{t("Shared with your company", "Compartido con su empresa")}</p>
      {error && <p role="alert">{error}</p>}
      <div className="gate-map-pin-actions"><PngPillButton color="brand" type="submit" disabled={saving || !label.trim() || !site}>{saving ? t("Saving…", "Guardando…") : t("Save Pin", "Guardar pin")}</PngPillButton><PngPillButton color="brand" type="button" disabled={saving} onClick={onClose}>{t("Cancel", "Cancelar")}</PngPillButton></div>
    </form>
  </VendorEditFlyout></Dialog.Root>;
}
