export type ReadinessEvidence = { id: string; completed: number; required: number; unknown: number };
const ids = ["training", "acknowledgements", "credentials", "drivers", "inspections", "correctiveActions"];
export function assessSafetyReadiness(incidentScore: number, evidence: ReadinessEvidence[]) {
  // Six fixed categories prevent an absent data source from inflating the others.
  const categories = ids.map(id => evidence.find(item => item.id === id) ?? { id, completed: 0, required: 0, unknown: 0 }).map(item => {
    const required = Math.max(0, item.required);
    const completed = Math.min(required, Math.max(0, item.completed));
    const unknown = Math.min(required - completed, Math.max(0, item.unknown));
    const points = required ? 10 * completed / required : 0;
    const provisional = required === 0 || unknown > 0;
    return { ...item, required, completed, unknown, outstanding: Math.max(0, required - completed - unknown), points, maximumPoints: required ? Math.min(10, points + 10 * unknown / required) : 10, provisional };
  });
  const incidentPoints = Math.max(0, Math.min(100, incidentScore)) * 0.4;
  const readinessPoints = categories.reduce((sum, c) => sum + c.points, 0);
  return { version: 1, incidentScore, incidentPoints, readinessPoints, readinessWeight: 60, incidentWeight: 40, score: Math.round(incidentPoints + readinessPoints), maximumScore: Math.round(incidentPoints + categories.reduce((sum, c) => sum + c.maximumPoints, 0)), provisional: categories.some(c => c.provisional), categories };
}

export function currentCredential(record: {vendorVerifiedAt: unknown; expirationDate: string | null; issuedDate?: string | null}, today: string) {
 return Boolean(record.vendorVerifiedAt && record.expirationDate && record.expirationDate >= today && (!record.issuedDate || record.issuedDate <= today));
}
export function currentFleetInspection(run: {vehicleAssetId:string;trailerAssetId:string|null;driverUserId:number;inspections:{vehicleAssetId:string;trailerAssetId:string|null;driverUserId:number;outcome:string}[]}) {
 const latest=run.inspections.at(-1);
 return Boolean(latest?.outcome === "passed" && latest.vehicleAssetId === run.vehicleAssetId && latest.trailerAssetId === run.trailerAssetId && latest.driverUserId === run.driverUserId);
}
