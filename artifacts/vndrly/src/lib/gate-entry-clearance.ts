export type GateEntryClearance = {
  admissionStatus?: string | null;
  entryClearanceAt?: string | null;
  reconciliationFacts?: Record<string, { value: string; source: string }> | null;
};

/** Clearance permits entry; it is never a physical-arrival observation. */
export function isGateEntryCleared(record: GateEntryClearance): boolean {
  const at = record.entryClearanceAt ?? record.reconciliationFacts?.entryClearanceAt?.value;
  return record.admissionStatus === "pending" && typeof at === "string" && Number.isFinite(Date.parse(at));
}
