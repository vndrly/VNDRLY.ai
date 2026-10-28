export type GateGpsEvidence = { status: string; gateName?: string | null; distanceMeters?: number | null };
export type GateRecordFlag = { key: string; label: string; title?: string };

export function gateDurationHHMM(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Describe recorded evidence only; routing/physical-proof failures are not missing GPS. */
export function gateRecordFlags(record: {
  checkInGpsEvidence?: GateGpsEvidence | null; checkOutGpsEvidence?: GateGpsEvidence | null;
  checkInTime?: string | null; checkOutTime?: string | null; expectedMinutes?: number | null;
  admissionStatus?: string | null; reconciliationState?: string | null;
  etaUnavailableReason?: string | null;
}, spanish = false, now = Date.now()): GateRecordFlag[] {
  const c = (en: string, es: string) => spanish ? es : en;
  const prefix = c("Location Flag: ", "Alerta de ubicación: ");
  const flags = new Map<string, GateRecordFlag>();
  const reasons: Record<string, string> = {
    unavailable: c("No GPS", "Sin GPS"),
    mismatch: c("Outside geofence", "Fuera de la geocerca"),
    gate_unconfigured: c("Gate coordinates missing", "Faltan coordenadas del acceso"),
  };
  for (const [source, evidence] of [[c("Check-in", "Entrada"), record.checkInGpsEvidence], [c("Check-out", "Salida"), record.checkOutGpsEvidence]] as const) {
    if (!evidence || !reasons[evidence.status]) continue;
    const title = [source, evidence.gateName, evidence.distanceMeters == null ? null : `${evidence.distanceMeters} m`].filter(Boolean).join(" · ");
    const previous = flags.get(evidence.status);
    flags.set(evidence.status, { key: evidence.status, label: prefix + reasons[evidence.status], title: previous ? `${previous.title}; ${title}` : title });
  }
  if (record.etaUnavailableReason === "gate_arrivals.location_unavailable") flags.set("unavailable", { key: "unavailable", label: prefix + reasons.unavailable });
  const start = Date.parse(record.checkInTime || "");
  const end = record.checkOutTime ? Date.parse(record.checkOutTime) : record.reconciliationState === "confirmed_off_site" ? NaN : now;
  if (record.admissionStatus !== "pending" && record.expectedMinutes != null && record.expectedMinutes > 0 && Number.isFinite(start) && Number.isFinite(end) && end - start > record.expectedMinutes * 60000) {
    flags.set("overdue", { key: "overdue", label: prefix + c(`Duration Time On Site ${gateDurationHHMM(end - start)} Overdue`, `Tiempo de permanencia ${gateDurationHHMM(end - start)} excedido`) });
  }
  return [...flags.values()];
}
