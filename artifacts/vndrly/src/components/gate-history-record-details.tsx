import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatPlateForDisplay } from "@/lib/plate-display";

export type GateHistoryRecord = {
  id: string; name?: string; company?: string | null; vehiclePlate?: string | null;
  plateState?: string | null; checkInTime?: string; checkOutTime?: string | null;
  reconciliationState?: string | null; admissionStatus?: string | null; kind?: string;
  entryClearanceAt?: string | null;
  notes?: string | null; purpose?: string | null; expectedMinutes?: number | null;
  gateStationId?: string | null;
  gateName?: string | null;
  gateAssociationSource?: "user_supplied_historical_correction" | "check_in_gps_evidence" | null;
  gateAssociationProvenance?: {
    source: string; correctionId: string; correctedAt: string; instruction: string;
  } | null;
  checkInGpsEvidence?: { status: string; gateName?: string; distanceMeters?: number | null } | null;
  checkOutGpsEvidence?: { status: string; gateName?: string; distanceMeters?: number | null } | null;
};

export default function GateHistoryRecordDetails({ open, record, loading, failed, onClose }: {
  open: boolean; record?: GateHistoryRecord; loading: boolean; failed: boolean; onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  const time = (value?: string | null) => value ? new Date(value).toLocaleString() : "";
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="max-w-xl">
    <DialogHeader><DialogTitle>{record?.name || c("Gate record", "Registro de acceso")}</DialogTitle>
    <DialogDescription>{c("Recorded details for this gate crossing.", "Detalles registrados de este cruce de acceso.")}</DialogDescription></DialogHeader>
    {loading ? <Loader2 className="animate-spin" /> : failed ? <p role="alert">{c("The record could not be loaded.", "No se pudo cargar el registro.")}</p> : !record ? <p role="status">{c("This record is unavailable in the selected site.", "Este registro no está disponible en el sitio seleccionado.")}</p> : <dl className="gate-record-facts text-sm">
      {[
        [c("Record", "Registro"), record.id],
        [c("Gate", "Acceso"), record.gateName || c("Unknown", "Desconocido")],
        [c("Gate association source", "Origen de la asociación del acceso"), record.gateName ? (
          record.gateAssociationSource === "user_supplied_historical_correction"
            ? c("User-supplied historical correction", "Corrección histórica proporcionada por el usuario")
            : record.gateAssociationSource === "check_in_gps_evidence"
              ? c("Recorded gate selection", "Selección de acceso registrada")
              : c("Unknown", "Desconocido")
        ) : null],
        [c("Company", "Empresa"), record.company],
        [c("Vehicle plate", "Placa del vehículo"), record.vehiclePlate ? formatPlateForDisplay(record.plateState, record.vehiclePlate, t("gatekeeper.plateStateUnconfirmed")) : null],
        [c("Check-in", "Entrada"), time(record.checkInTime)],
        [c("Check-out", "Salida"), record.reconciliationState === "confirmed_off_site" ? c("Departure time unknown", "Hora de salida desconocida") : time(record.checkOutTime) || (record.admissionStatus === "pending" ? c("Pending admission", "Admisión pendiente") : c("On Site", "En el sitio"))],
        [c("Expected minutes", "Minutos previstos"), record.expectedMinutes == null ? null : String(record.expectedMinutes)],
        [c("Purpose", "Propósito"), record.purpose],
        [c("Notes", "Notas"), record.notes],
      ].filter(([, value]) => value != null && value !== "").map(([label, value]) => <div key={label}><dt className="!text-gray-600">{label}</dt><dd className="whitespace-pre-wrap text-gray-900">{value}</dd></div>)}
    </dl>}
  </DialogContent></Dialog>;
}
