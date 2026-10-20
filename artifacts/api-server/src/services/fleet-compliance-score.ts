import { createHash } from "node:crypto";
import { FleetComplianceScoreSchema, type FleetComplianceOperationalEntry, type FleetComplianceScore } from "@workspace/api-zod";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import { resolveFleetCapabilities } from "./fleet-mobile-permissions";

type Category = FleetComplianceScore["categories"][number]["category"];
type Deduction = FleetComplianceScore["deductions"][number];
const categories: readonly Category[] = ["vehicle", "driver_license", "insurance", "company_records"];
const guidance: Record<Category, { remediation: string; destination: string; capability: Deduction["responsibleCapability"] }> = {
  vehicle: { remediation: "Review vehicle records and upload current evidence for Office review.", destination: "/fleet/compliance/subjects?kind=vehicle", capability: "office" },
  driver_license: { remediation: "Review the driver's license record and submit current evidence for Office review.", destination: "/fleet/compliance/subjects?kind=driver", capability: "office" },
  insurance: { remediation: "Review coverage and submit a current insurance source for Office review.", destination: "/fleet/compliance/subjects?kind=carrier", capability: "office" },
  company_records: { remediation: "Review company requirements and submit the missing record for Office review.", destination: "/fleet/compliance/subjects?kind=carrier", capability: "office" },
};

function categoryFor(entry: Pick<FleetComplianceOperationalEntry, "subject" | "kind">): Category {
  if (entry.kind === "insurance") return "insurance";
  if (entry.kind === "driver_license") return "driver_license";
  if (entry.subject.kind === "vehicle" || entry.subject.kind === "component") return "vehicle";
  return "company_records";
}

function coverageId(companyId: number, category: Category): string {
  const h = createHash("sha256").update(`fleet-compliance-coverage:${companyId}:${category}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Uses the permission-scoped operational register. Unknown coverage earns no points. */
export function projectFleetComplianceScore(companyId: number, entries: readonly Pick<FleetComplianceOperationalEntry, "id" | "subject" | "kind" | "verification" | "status" | "reasons" | "validUntil" | "evaluatedAt">[], evaluatedAt = new Date().toISOString()) {
  const deductions: Deduction[] = [];
  const categoryScores = categories.map((category) => {
    const records = entries.filter((entry) => categoryFor(entry) === category);
    const failing = records.filter((entry) => entry.status !== "green" || entry.verification !== "verified" || !!entry.validUntil && Date.parse(entry.validUntil) <= Date.parse(evaluatedAt));
    if (!records.length) {
      deductions.push({ id: coverageId(companyId, category), category, points: 25, reason: `No current evidence is available for ${category.replaceAll("_", " ")}.`, urgency: "soon", estimatedImprovement: 25, remediation: guidance[category].remediation, evidenceDestination: guidance[category].destination, responsibleCapability: guidance[category].capability, dueAt: null });
      return { category, score: 0 };
    }
    const lost = Math.ceil(25 * failing.length / records.length);
    const oneResolved = Math.ceil(25 * Math.max(0, failing.length - 1) / records.length);
    failing.forEach((entry, index) => {
      const points = Math.floor(lost / failing.length) + (index < lost % failing.length ? 1 : 0);
      const expired = !!entry.validUntil && Date.parse(entry.validUntil) <= Date.parse(evaluatedAt);
      deductions.push({ id: entry.id, category, points, reason: expired ? `Expired ${category.replaceAll("_", " ")} record.` : entry.reasons[0] ?? `Current ${category.replaceAll("_", " ")} evidence requires review.`, urgency: expired ? "now" : entry.status === "red" ? "soon" : "later", estimatedImprovement: lost - oneResolved, remediation: guidance[category].remediation, evidenceDestination: guidance[category].destination, responsibleCapability: guidance[category].capability, dueAt: entry.validUntil });
    });
    return { category, score: 100 - lost * 4 };
  });
  const pointsLost = deductions.reduce((sum, item) => sum + item.points, 0);
  const score = Math.max(0, 100 - pointsLost);
  const status = score < 60 ? "red" : score < 85 ? "amber" : "green";
  const urgency = { now: 0, soon: 1, later: 2 } as const;
  deductions.sort((a, b) => urgency[a.urgency] - urgency[b.urgency] || b.estimatedImprovement - a.estimatedImprovement || a.id.localeCompare(b.id));
  const visible = deductions.slice(0, 100);
  const resolved = new Set(visible.map((item) => item.id));
  const estimatedRemainingLoss = categories.reduce((sum, category) => {
    const records = entries.filter((entry) => categoryFor(entry) === category);
    if (!records.length) return sum + (resolved.has(coverageId(companyId, category)) ? 0 : 25);
    const stillFailing = records.filter((entry) => !resolved.has(entry.id) && (entry.status !== "green" || entry.verification !== "verified" || !!entry.validUntil && Date.parse(entry.validUntil) <= Date.parse(evaluatedAt))).length;
    return sum + Math.ceil(25 * stillFailing / records.length);
  }, 0);
  return FleetComplianceScoreSchema.parse({
    companyId, score, status, advisoryOnly: true, evaluatedAt, categories: categoryScores, deductions: visible, history: [],
    categoryTotals: categoryScores.map((item) => ({ ...item, pointsAvailable: 25, pointsEarned: item.score / 4 })),
    estimatedResolvedScore: Math.max(score, 100 - estimatedRemainingLoss),
    remainingIssueCount: deductions.length - visible.length,
    partnerPreview: { score, status, advisoryOnly: true as const, evaluatedAt, categories: categoryScores, reasons: visible.map((item) => ({ category: item.category, reason: item.reason })) },
  });
}

type Register = { assertFleetComplianceScoreAccess: (actor: FleetActor) => Promise<void>; readFleetComplianceRegister: (actor: FleetActor, query: unknown) => Promise<{ entries: FleetComplianceOperationalEntry[]; nextCursor: string | null }> };
/** Reuses canonical register authorization and its current facts/evidence assessment. */
export async function readFleetComplianceScore(actor: FleetActor, register: Register, capabilities = resolveFleetCapabilities) {
  const current = await capabilities(actor, actor.companyId);
  if (!["admin", "office", "dispatch"].some((capability) => current.has(capability as "admin" | "office" | "dispatch")))
    throw new FleetError("fleet.permission_denied", 403);
  await register.assertFleetComplianceScoreAccess(actor);
  const entries: FleetComplianceOperationalEntry[] = [];
  let after: string | null = null;
  do {
    const page = await register.readFleetComplianceRegister(actor, { limit: 100, ...(after ? { after } : {}) });
    entries.push(...page.entries);
    after = page.nextCursor;
  } while (after);
  return projectFleetComplianceScore(actor.companyId, entries);
}
