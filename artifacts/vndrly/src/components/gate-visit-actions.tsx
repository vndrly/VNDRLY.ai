import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { changeOverRequest } from "@/lib/change-over-api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Visit = {
  id: number; firstName: string; lastName: string; company?: string | null;
  vehiclePlate?: string | null; plateState?: string | null; checkOutTime?: string | null;
};

export function GateVisitActions({ siteId, gateId, visit, disabled, allowUndo = false }: {
  siteId: number; gateId: string; visit: Visit; disabled?: boolean; allowUndo?: boolean;
}) {
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  const cache = useQueryClient();
  const [mode, setMode] = useState<"edit" | "undo-checkout" | null>(null);
  const [details, setDetails] = useState({
    firstName: visit.firstName, lastName: visit.lastName, company: visit.company ?? "",
    vehiclePlate: visit.vehiclePlate ?? "", plateState: visit.plateState ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  function open(action: "edit" | "undo-checkout") {
    setDetails({ firstName: visit.firstName, lastName: visit.lastName, company: visit.company ?? "",
      vehiclePlate: visit.vehiclePlate ?? "", plateState: visit.plateState ?? "" });
    setError(""); setMode(action);
  }
  async function save() {
    if (!mode || disabled || inFlight.current) return;
    const body = { siteId, gateId, visitId: visit.id, action: mode,
      ...(mode === "edit" ? { details } : { expectedCheckoutAt: visit.checkOutTime }) };
    const fingerprint = JSON.stringify(body);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setSaving(true); setError("");
    try {
      await changeOverRequest("/visit-corrections", { ...body, operationId: operation.current.id });
      setMode(null);
      operation.current = null;
      for (const key of ["gate-area-traffic", "gatekeeper-visits", "gatekeeper-departures", "gatekeeper-recent-visits", "gate-history-report", "gate-coverage-map"]) {
        void cache.invalidateQueries({ queryKey: [key] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : c("Could not save the correction.", "No se pudo guardar la corrección."));
    } finally {
      inFlight.current = false; setSaving(false);
    }
  }
  const labels = { firstName: c("First name", "Nombre"), lastName: c("Last name", "Apellido"),
    company: c("Company", "Empresa"), vehiclePlate: c("Tag", "Placa"), plateState: c("Issuing state", "Estado emisor") };
  return <>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="gate-history-filter" disabled={disabled} onClick={() => open("edit")}>{c("Edit", "Editar")}</button>
      {allowUndo && visit.checkOutTime && <button type="button" className="gate-history-filter" disabled={disabled} onClick={() => open("undo-checkout")}>{c("Undo check-out", "Revertir salida")}</button>}
    </div>
    <Dialog open={mode !== null} onOpenChange={next => { if (!next && !inFlight.current) setMode(null); }}>
      <DialogContent>
        <DialogTitle>{mode === "edit" ? c("Edit visit", "Editar visita") : c("Undo check-out", "Revertir salida")}</DialogTitle>
        <DialogDescription>{mode === "edit" ? c("Correct the saved driver and vehicle details.", "Corrija los datos del conductor y del vehículo.") : c("Restore this driver to On Site.", "Devuelva a este conductor a En sitio.")}</DialogDescription>
        <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          {mode === "edit" && (Object.keys(labels) as (keyof typeof labels)[]).map(key =>
            <label key={key} className="grid gap-1 text-sm">{labels[key]}
              <input className="rounded-md border bg-background px-3 py-2" value={details[key]}
                onChange={event => setDetails(current => ({ ...current, [key]: event.target.value }))}
                required={key === "firstName" || key === "lastName"} disabled={saving} />
            </label>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" className="gate-history-filter justify-self-end" disabled={saving || disabled}>
            {mode === "edit" ? c("Save", "Guardar") : c("Restore to On Site", "Restaurar a En sitio")}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
