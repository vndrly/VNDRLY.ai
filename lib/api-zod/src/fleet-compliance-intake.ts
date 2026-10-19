import { z } from "zod/v4";
import {
  FleetComplianceSubjectSchema,
  fleetComplianceSubjectKey,
  type FleetRequirementVersion,
} from "./fleet-compliance";
import {
  FleetComplianceRecordSchema,
  FleetComplianceRecordReceiptSchema,
  type FleetComplianceRecord,
} from "./fleet-compliance-register";
import { FleetCoverageTypeSchema } from "./fleet-insurance";
export const FleetComplianceIntakeDraftSchema = z
  .object({
    id: z.uuid(),
    subject: FleetComplianceSubjectSchema,
    kind: z.enum([
      "driver_license",
      "driver_medical",
      "driver_testing",
      "driver_qualification",
      "duty",
      "insurance",
      "credential",
    ]),
    source: z.string().trim().min(1).max(500),
    at: z.iso.datetime({ offset: true }),
    coverageType: FleetCoverageTypeSchema.optional(),
    requirement: z
      .object({
        id: z.string().trim().min(1).max(160),
        version: z.number().int().positive(),
        label: z.string().trim().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "insurance" && !value.coverageType)
      ctx.addIssue({
        code: "custom",
        path: ["coverageType"],
        message: "Choose the source coverage category",
      });
  });
/** Empty intake is received, private and unknown. It must never synthesize a
 * license, zero limit, ELD clearance, agency filing or reviewer decision. An
 * unmapped source can be retained before a company adopts its requirements. */
export function createFleetComplianceSourceDraft(
  input: z.input<typeof FleetComplianceIntakeDraftSchema>,
): FleetComplianceRecord {
  const value = FleetComplianceIntakeDraftSchema.parse(input);
  let attributes: unknown;
  switch (value.kind) {
    case "driver_license":
      attributes = {
        kind: value.kind,
        issuingState: null,
        licenseNumber: null,
        licenseClass: null,
        endorsements: [],
        restrictions: [],
        licenseStatus: "unverified",
        sourceRecordId: null,
      };
      break;
    case "driver_medical":
      attributes = {
        kind: value.kind,
        qualification: "unverified",
        examinerReference: null,
        restrictions: [],
      };
      break;
    case "driver_testing":
      attributes = {
        kind: value.kind,
        program: null,
        result: "unverified",
        clearinghouseConsentAt: null,
        queryReference: null,
      };
      break;
    case "driver_qualification":
      attributes = {
        kind: value.kind,
        check: "DQ_file",
        result: "unverified",
        sourceRecordId: null,
      };
      break;
    case "duty":
      attributes = {
        kind: value.kind,
        source: "unavailable",
        dutyStatus: "unknown",
        asOf: value.at,
        sourceRecordId: null,
      };
      break;
    case "insurance":
      attributes = {
        kind: value.kind,
        coverage: {
          id: value.id,
          revision: 1,
          policyNumber: null,
          insuredLegalEntity: null,
          privateDocumentRef: null,
          coverageType: value.coverageType,
          state: "document_received",
          reviewedByUserId: null,
          reviewedAt: null,
          validFrom: null,
          validUntil: null,
          carrierIds: null,
          states: null,
          cargoCodes: null,
          equipmentIds: null,
          scopesReviewed: false,
          limitUSD: null,
          filingStatus: "unverified",
          filingVerifiedAt: null,
          underlyingPolicyId: null,
          attachmentPointUSD: null,
          followFormReviewed: false,
        },
      };
      break;
    default:
      attributes = {
        kind: "credential",
        credentialType: value.requirement?.label ?? "Unmapped source",
        reference: null,
        issuingAuthority: null,
        states: [],
        cargoCodes: [],
      };
  }
  const retentionClass =
    value.kind === "insurance"
      ? "insurance"
      : value.kind === "driver_medical"
        ? "medical"
        : value.kind === "driver_testing"
          ? "testing"
          : value.subject.kind === "driver"
            ? "qualification"
            : value.subject.kind === "trip"
              ? "trip"
              : ["vehicle", "component"].includes(value.subject.kind)
                ? "maintenance"
                : "authority";
  return FleetComplianceRecordSchema.parse({
    evidence: {
      id: value.id,
      revision: 1,
      subject: value.subject,
      requirementId: value.requirement?.id ?? `unmapped:${value.kind}`,
      requirementVersion: value.requirement?.version ?? 1,
      status: "document_received",
      validFrom: null,
      validUntil: null,
      verifiedAt: null,
      verifiedByUserId: null,
      source: value.source,
      privateDocumentRef: null,
      restrictions: {},
    },
    attributes,
    retentionClass,
    retainUntil: null,
    legalHold: false,
  });
}
export function verifyFleetComplianceSourceReceipt(
  record: FleetComplianceRecord,
  result: unknown,
  readback: unknown,
) {
  const saved = FleetComplianceRecordReceiptSchema.parse(result),
    canonical = FleetComplianceRecordReceiptSchema.parse(readback),
    expected = record.evidence;
  if (
    saved.id !== expected.id ||
    saved.revision !== expected.revision ||
    saved.status !== expected.status ||
    fleetComplianceSubjectKey(saved.subject) !==
      fleetComplianceSubjectKey(expected.subject) ||
    JSON.stringify(saved) !== JSON.stringify(canonical)
  )
    throw new Error(
      "Source receipt does not match the exact received revision",
    );
  return canonical;
}
type SourceField = {
  key: string;
  label: { en: string; es: string };
  options?: readonly string[];
  multiline?: boolean;
};
const field = (
  key: string,
  en: string,
  es: string,
  options?: readonly string[],
  multiline = false,
): SourceField => ({
  key,
  label: { en, es },
  ...(options ? { options } : {}),
  ...(multiline ? { multiline: true } : {}),
});
export const FLEET_COMPLIANCE_SOURCE_KINDS = {
  driver_license: { en: "Driver license", es: "Licencia del conductor" },
  driver_medical: { en: "Medical qualification", es: "Calificación médica" },
  driver_testing: {
    en: "Testing program / query",
    es: "Programa de pruebas / consulta",
  },
  driver_qualification: {
    en: "Driver qualification records",
    es: "Registros de calificación del conductor",
  },
  duty: { en: "Duty / hours source", es: "Fuente de jornada / horas" },
  insurance: {
    en: "Insurance policy / certificate",
    es: "Póliza / certificado de seguro",
  },
  credential: {
    en: "Authority, inspection or other credential",
    es: "Autorización, inspección u otra credencial",
  },
} as const;
export function fleetComplianceSourceSupportsRequirement(
  kind: keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS,
  category: FleetRequirementVersion["category"],
): boolean {
  const categories: Record<
    keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS,
    ReadonlyArray<FleetRequirementVersion["category"]>
  > = {
    driver_license: ["driver_license"],
    driver_medical: ["driver_medical"],
    driver_testing: ["driver_testing"],
    driver_qualification: ["driver_qualification", "training"],
    duty: ["duty"],
    insurance: ["insurance"],
    credential: [
      "authority",
      "vehicle_registration",
      "vehicle_inspection",
      "maintenance",
      "tank_test",
      "training",
      "permit",
      "cargo",
      "customer",
      "other",
    ],
  };
  return categories[kind].includes(category);
}
/** Select the newest adopted revision before considering source compatibility. */
export function fleetComplianceSourceRequirements(
  requirements: readonly FleetRequirementVersion[],
  subjectKind: z.infer<typeof FleetComplianceSubjectSchema>["kind"],
  sourceKind: keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS,
  boundRequirementId?: string,
): FleetRequirementVersion[] {
  const latest = new Map<string, FleetRequirementVersion>();
  for (const rule of requirements) {
    if (!latest.has(rule.id) || latest.get(rule.id)!.version < rule.version)
      latest.set(rule.id, rule);
  }
  return [...latest.values()].filter(rule =>
    (!boundRequirementId || rule.id === boundRequirementId) &&
    rule.subjectKinds.includes(subjectKind) &&
    fleetComplianceSourceSupportsRequirement(sourceKind, rule.category));
}
export function fleetComplianceSourceFields(
  kind: keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS,
): SourceField[] {
  const specific: Record<
    keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS,
    SourceField[]
  > = {
    driver_license: [
      field("licenseNumber", "License number", "Número de licencia"),
      field(
        "issuingState",
        "Issuing state (two letters)",
        "Estado emisor (dos letras)",
      ),
      field("licenseClass", "License class", "Clase de licencia", [
        "A",
        "B",
        "C",
        "other",
      ]),
      field(
        "licenseStatus",
        "Reported license status",
        "Estado reportado de licencia",
        ["unverified", "active", "expired", "suspended", "revoked"],
      ),
      field(
        "endorsements",
        "Endorsements (one per line)",
        "Habilitaciones (una por línea)",
        undefined,
        true,
      ),
      field(
        "restrictions",
        "Restrictions (one per line)",
        "Restricciones (una por línea)",
        undefined,
        true,
      ),
      field(
        "sourceRecordId",
        "Source record reference",
        "Referencia del registro fuente",
      ),
    ],
    driver_medical: [
      field(
        "qualification",
        "Reported qualification",
        "Calificación reportada",
        ["unverified", "qualified", "not_qualified", "pending"],
      ),
      field(
        "examinerReference",
        "Examiner / qualification reference",
        "Referencia del examinador / calificación",
      ),
      field(
        "restrictions",
        "Operational restrictions (one per line)",
        "Restricciones operativas (una por línea)",
        undefined,
        true,
      ),
    ],
    driver_testing: [
      field("program", "Program type", "Tipo de programa", ["DOT", "non_DOT"]),
      field("result", "Reported status", "Estado reportado", [
        "unverified",
        "eligible",
        "prohibited",
        "pending",
      ]),
      field(
        "clearinghouseConsentAt",
        "Consent time, if known (include time zone)",
        "Fecha de consentimiento, si se conoce (incluya zona horaria)",
      ),
      field("queryReference", "Query reference", "Referencia de consulta"),
    ],
    driver_qualification: [
      field(
        "check",
        "Qualification record type",
        "Tipo de registro de calificación",
        [
          "DQ_file",
          "MVR",
          "road_test",
          "training",
          "annual_review",
          "employment_history",
        ],
      ),
      field("result", "Reported result", "Resultado reportado", [
        "unverified",
        "satisfactory",
        "unsatisfactory",
        "pending",
      ]),
      field(
        "sourceRecordId",
        "Source record reference",
        "Referencia del registro fuente",
      ),
    ],
    duty: [
      field("dutySource", "Source type", "Tipo de fuente", [
        "unavailable",
        "ELD",
        "reviewed_paper_log",
        "driver_report",
      ]),
      field("dutyStatus", "Reported availability", "Disponibilidad reportada", [
        "unknown",
        "available",
        "unavailable",
      ]),
      field(
        "asOf",
        "Source as-of time (include time zone)",
        "Fecha de la fuente (incluya zona horaria)",
      ),
      field(
        "sourceRecordId",
        "Source record reference",
        "Referencia del registro fuente",
      ),
    ],
    insurance: [
      field("coverageStates", "Covered states (one code per line; * only if unrestricted; blank if unknown)", "Estados cubiertos (un código por línea; * solo si no hay restricción; vacío si se desconoce)", undefined, true),
      field("coverageCargoCodes", "Covered cargo codes (one per line; * only if unrestricted; blank if unknown)", "Códigos de carga cubiertos (uno por línea; * solo sin restricción; vacío si se desconoce)", undefined, true),
      field("coverageCarrierIds", "Covered carrier company IDs (one per line; blank if unknown)", "Identificadores de transportistas cubiertos (uno por línea; vacío si se desconoce)", undefined, true),
      field("coverageEquipmentIds", "Covered Inventory asset IDs (one per line; * only if unrestricted; blank if unknown)", "Identificadores de activos de Inventario cubiertos (uno por línea; * solo sin restricción; vacío si se desconoce)", undefined, true),
      field("underlyingPolicyId", "Underlying policy evidence ID (excess only, if known)", "Identificador de evidencia de póliza base (solo exceso, si se conoce)"),
      field("attachmentPointUSD", "Exact excess attachment point (USD), if known", "Punto exacto de activación del exceso (USD), si se conoce"),
      field("policyNumber", "Policy number", "Número de póliza"),
      field(
        "insuredLegalEntity",
        "Insured legal entity",
        "Entidad legal asegurada",
      ),
      field(
        "limitUSD",
        "Exact policy limit (USD)",
        "Límite exacto de póliza (USD)",
      ),
    ],
    credential: [
      field("issuingAuthority", "Issuing authority", "Autoridad emisora"),
      field(
        "credentialReference",
        "Credential reference",
        "Referencia de credencial",
      ),
    ],
  };
  return [
    ...specific[kind],
    field(
      "validFrom",
      "Source valid from, if known (include time zone)",
      "Vigente desde, si se conoce (incluya zona horaria)",
    ),
    field(
      "validUntil",
      "Source expires, if known (include time zone)",
      "Vencimiento, si se conoce (incluya zona horaria)",
    ),
  ];
}
/** Transcribed source facts are still received and unverified. This is not a
 * reviewer command, coverage-scope approval, clinical record or payroll claim. */
export function updateFleetComplianceSourceDraft(
  input: FleetComplianceRecord,
  fields: Record<string, string>,
): FleetComplianceRecord {
  const original = FleetComplianceRecordSchema.parse(input);
  if (original.evidence.status !== "document_received" || original.review)
    throw new Error("Only an unverified received draft can be edited");
  if (
    original.attributes.kind === "duty" &&
    original.attributes.source === "unavailable" &&
    fields.dutySource &&
    fields.dutySource !== "unavailable" &&
    !fields.asOf?.trim()
  )
    throw new Error("The actual duty source as-of time is required");
  const allowed = new Set(
    fleetComplianceSourceFields(original.attributes.kind).map(
      (item) => item.key,
    ),
  );
  // Zod's parse above already produced a typed deep copy of the input. Keep
  // this shared code usable in runtimes without the structuredClone global.
  const record = original,
    attributes: Record<string, unknown> = { ...record.attributes };
  for (const [key, text] of Object.entries(fields)) {
    if (!allowed.has(key) || typeof text !== "string")
      throw new Error("Field does not belong to this source register");
    const value = text.trim() || null;
    if (key === "validFrom" || key === "validUntil")
      record.evidence[key] = value;
    else if (["endorsements", "restrictions"].includes(key))
      attributes[key] = text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
    else if (key === "dutySource") attributes.source = value;
    else if (key === "credentialReference") attributes.reference = value;
    else if (original.attributes.kind === "insurance") {
      const coverage = attributes.coverage as Record<string, unknown>;
      const scopeKeys: Record<string, string> = { coverageStates: "states", coverageCargoCodes: "cargoCodes", coverageCarrierIds: "carrierIds", coverageEquipmentIds: "equipmentIds" };
      const scopeKey = scopeKeys[key];
      let next: unknown = value;
      if (scopeKey && value !== null) {
        const items = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        if (items.includes("*") && (items.length !== 1 || scopeKey === "carrierIds"))
          throw new Error("Unrestricted scope must be explicitly stated on its own");
        next = items[0] === "*" ? [] : items.map(item => {
          if (scopeKey === "states") return item.toUpperCase();
          if (scopeKey === "equipmentIds") return item.toLowerCase();
          if (scopeKey === "carrierIds") {
            if (!/^[1-9][0-9]*$/.test(item) || !Number.isSafeInteger(Number(item)))
              throw new Error("A canonical carrier company ID is required");
            return Number(item);
          }
          return item;
        });
      }
      attributes.coverage = { ...coverage, [scopeKey ?? key]: key === "underlyingPolicyId" ? value?.toLowerCase() ?? null : next };
    } else
      attributes[key] =
        key === "issuingState" ? (value?.toUpperCase() ?? null) : value;
  }
  if (original.attributes.kind === "insurance")
    attributes.coverage = {
      ...(attributes.coverage as Record<string, unknown>),
      validFrom: record.evidence.validFrom,
      validUntil: record.evidence.validUntil,
    };
  return FleetComplianceRecordSchema.parse({ ...record, attributes });
}
export function fleetComplianceSourceChoiceLabel(
  value: string,
  language: "en" | "es",
): string {
  const labels: Record<string, [string, string]> = {
    other: ["Other", "Otra"],
    unverified: ["Unverified", "Sin verificar"],
    active: ["Active", "Vigente"],
    expired: ["Expired", "Vencida"],
    suspended: ["Suspended", "Suspendida"],
    revoked: ["Revoked", "Revocada"],
    qualified: ["Qualified", "Calificado"],
    not_qualified: ["Not qualified", "No calificado"],
    pending: ["Pending", "Pendiente"],
    eligible: ["Eligible", "Elegible"],
    prohibited: ["Prohibited", "Prohibido"],
    non_DOT: ["Non-DOT", "No DOT"],
    DQ_file: ["Qualification file", "Expediente de calificación"],
    MVR: ["Driving record (MVR)", "Historial de manejo (MVR)"],
    road_test: ["Road test / equivalent", "Prueba de manejo / equivalente"],
    training: ["Training", "Capacitación"],
    annual_review: [
      "Annual driving-record review",
      "Revisión anual del historial de manejo",
    ],
    employment_history: ["Employment history", "Historial de empleo"],
    satisfactory: ["Satisfactory", "Satisfactorio"],
    unsatisfactory: ["Unsatisfactory", "Insatisfactorio"],
    unavailable: ["Unavailable", "No disponible"],
    ELD: ["ELD record", "Registro ELD"],
    reviewed_paper_log: ["Reviewed paper log", "Bitácora en papel revisada"],
    driver_report: ["Driver report", "Reporte del conductor"],
    unknown: ["Unknown", "Desconocido"],
    available: ["Available", "Disponible"],
    auto_liability: ["Auto liability", "Responsabilidad civil de vehículos"],
    cargo: ["Cargo", "Carga"],
    pollution: ["Pollution", "Contaminación"],
    general_liability: ["General liability", "Responsabilidad civil general"],
    physical_damage: ["Physical damage", "Daños físicos"],
    workers_compensation: ["Workers compensation", "Compensación laboral"],
    excess: ["Excess / umbrella", "Exceso / cobertura adicional"],
  };
  return labels[value]?.[language === "es" ? 1 : 0] ?? value;
}
