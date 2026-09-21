export interface ChangeOverFact {
  id: string;
  text: string;
}
export interface ChangeOverSnapshot {
  generatedAt: string;
  startedAt: string;
  revision: string;
  coverage: string;
  metrics: {
    checkIns: number;
    checkOuts: number;
    onSiteVisitorRecords: number;
    onSiteEmployeeRecords: number;
    onSiteVehicles: number;
    pendingAdmission: number;
  };
  outstanding: {
    id: string;
    kind: string;
    name: string;
    company: string | null;
    plate: string | null;
    checkIn: string;
    notes: string | null;
  }[];
  exceptions: { sourceId: string; code: string; text: string }[];
  openItems: { id: string; text: string; status: string }[];
  facts: ChangeOverFact[];
}
export interface ChangeOverPreparation {
  id: string;
  notes: string;
  snapshot: ChangeOverSnapshot;
  summary: { source: string; facts: ChangeOverFact[] };
  created_at: string;
}
export interface ChangeOverState {
  station: { id: string; name: string; site_id: number };
  site: { id: number; name: string };
  supervisor: boolean;
  shift: {
    id: string;
    operator_id: number;
    operator_name: string;
    started_at: string;
    preparation_id: string | null;
  } | null;
  preparation: ChangeOverPreparation | null;
  snapshot: ChangeOverSnapshot | null;
  stale: boolean;
  items: { id: string; text: string; status: string }[];
}
export interface ShiftNote extends ChangeOverPreparation {
  acknowledged_at: string;
  outgoing_name: string;
  incoming_name: string;
  started_at: string;
  ended_at: string;
}
export interface ShiftNotesResponse {
  rows: ShiftNote[];
  nextBefore: string | null;
  actions: {
    id: string;
    actor_name: string;
    text: string;
    kind: string;
    created_at: string;
  }[];
  retention: string;
}
export interface IncomingHandoffAuth {
  proof: string;
  incoming: { id: number; displayName: string };
  expiresInSeconds: number;
}
export function mayTransferHandoff(input: {
  online: boolean;
  acknowledged: boolean;
  proof: string;
  reviewedRevision: string;
  currentRevision: string;
  stale: boolean;
}) {
  return (
    input.online &&
    input.acknowledged &&
    Boolean(input.proof) &&
    Boolean(input.reviewedRevision) &&
    input.reviewedRevision === input.currentRevision &&
    !input.stale
  );
}
