import {
  FleetComplianceRequirementAdoptSchema,
  FleetComplianceRequirementsViewSchema,
} from "./fleet-compliance-register";
import {
  FleetRequirementVersionSchema,
  type FleetRequirementVersion,
} from "./fleet-compliance";
import {
  FLEET_COMPLIANCE_RESEARCH_AS_OF,
  FLEET_OK_CHAPTER_30_SOURCE,
} from "./fleet-compliance-rulebook";

type Reference = {
  id: string;
  label: { en: string; es: string };
  guidance: { en: string; es: string };
  category: FleetRequirementVersion["category"];
  subjectKinds: FleetRequirementVersion["subjectKinds"];
  jurisdiction: "federal" | "OK" | "TX";
  applicabilityFact: string;
  expiryRequired: boolean;
  source: { url: string; section: string };
};
const cfr = (part: string) =>
  `https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-${part}`;
/** Reference drafts only. No research author is a company reviewer; adoption
 * stamps the real authenticated reviewer on the server. These explicit facts
 * must be reviewed for the actual work, including exceptions, not inferred from
 * a title, a home state, payroll clock or one weight value. */
export const FLEET_REQUIREMENT_TEMPLATES: ReadonlyArray<
  Reference & { researchedAt: string }
> = [
  {
    id: "federal-usdot",
    label: { en: "USDOT registration", es: "Registro USDOT" },
    category: "authority",
    subjectKinds: ["carrier"],
    jurisdiction: "federal",
    applicabilityFact: "usdotRequired",
    expiryRequired: false,
    source: {
      url: "https://www.fmcsa.dot.gov/registration/do-i-need-usdot-number",
      section: "USDOT applicability and state registration; 49 CFR Part 390",
    },
    guidance: {
      en: "Review commerce, actual/rated combination weights, passengers, hazardous-material permits and state rules. A same-state trip can still be interstate commerce.",
      es: "Revise comercio, pesos reales y nominales de la combinación, pasajeros, permisos peligrosos y reglas estatales. Un viaje dentro de un estado puede ser comercio interestatal.",
    },
  },
  {
    id: "tx-carrier-registration",
    label: {
      en: "Texas carrier registration and cab card",
      es: "Registro de transportista y tarjeta de cabina de Texas",
    },
    category: "authority",
    subjectKinds: ["carrier"],
    jurisdiction: "TX",
    applicabilityFact: "txCarrierRegistrationRequired",
    expiryRequired: true,
    source: {
      url: "https://www.txdmv.gov/motor-carriers/txdmv-number",
      section:
        "Registration triggers, cab cards and TxMCCS; 43 TAC Chapter 218",
    },
    guidance: {
      en: "Review Texas intrastate applicability, all relevant weight measures, placarded materials, passengers and household goods. Confirm the issued certificate and actual expiry; insurance filing is separate.",
      es: "Revise operación intraestatal de Texas, todas las medidas de peso, materiales con placas, pasajeros y mudanzas. Confirme certificado emitido y vencimiento real; la presentación del seguro es distinta.",
    },
  },
  {
    id: "ok-carrier-authority",
    label: {
      en: "Oklahoma carrier license / authority",
      es: "Licencia o autorización de transportista de Oklahoma",
    },
    category: "authority",
    subjectKinds: ["carrier"],
    jurisdiction: "OK",
    applicabilityFact: "okCarrierAuthorityRequired",
    expiryRequired: true,
    source: {
      url: FLEET_OK_CHAPTER_30_SOURCE,
      section:
        "OAC 165:30; private and for-hire licensing; official OAC controls",
    },
    guidance: {
      en: "Determine the actual private or for-hire operation, commodity, state authority and exemptions under the controlling OAC. This convenience copy is a reference; record the issued credential and source expiry.",
      es: "Determine operación privada o por contrato, mercancía, autorización estatal y excepciones conforme al OAC vigente. Esta copia es referencia; registre credencial emitida y vencimiento de la fuente.",
    },
  },
  {
    id: "federal-periodic-inspection",
    label: {
      en: "Periodic inspection — each vehicle/component",
      es: "Inspección periódica — cada vehículo/componente",
    },
    category: "vehicle_inspection",
    subjectKinds: ["vehicle", "component"],
    jurisdiction: "federal",
    applicabilityFact: "periodicInspectionRequired",
    expiryRequired: true,
    source: {
      url: `${cfr("396")}/subpart-B/section-396.17`,
      section:
        "49 CFR 396.17; applicability, qualified inspection and documentation",
    },
    guidance: {
      en: "Review Part 396 applicability and each combination member. Use the qualified inspection record's calendar due date; a truck inspection alone does not establish trailer inspection or tank-test compliance.",
      es: "Revise aplicabilidad de Parte 396 y cada miembro de la combinación. Use fecha calendario del registro calificado; inspeccionar el camión no acredita inspección del remolque ni pruebas del tanque.",
    },
  },
  {
    id: "driver-license",
    label: {
      en: "Driver license, class and endorsements",
      es: "Licencia, clase y habilitaciones del conductor",
    },
    category: "driver_license",
    subjectKinds: ["driver"],
    jurisdiction: "federal",
    applicabilityFact: "cdlRequired",
    expiryRequired: true,
    source: {
      url: cfr("383"),
      section:
        "49 CFR Part 383; issuing-state status, classes, endorsements and restrictions",
    },
    guidance: {
      en: "Review the actual vehicle combination and cargo, applicable CDL exceptions, issuing-state status, restrictions and endorsements. An ordinary review cannot waive a suspended or revoked license.",
      es: "Revise combinación y carga reales, excepciones CDL, estado emisor, restricciones y habilitaciones. Una revisión ordinaria no puede eximir una licencia suspendida o revocada.",
    },
  },
  {
    id: "driver-qualification",
    label: {
      en: "Driver qualification file",
      es: "Expediente de calificación del conductor",
    },
    category: "driver_qualification",
    subjectKinds: ["driver"],
    jurisdiction: "federal",
    applicabilityFact: "driverQualificationRequired",
    expiryRequired: false,
    source: {
      url: `${cfr("391")}/subpart-F/section-391.51`,
      section:
        "49 CFR 391.51 and 391.23; qualification records and applicable exceptions",
    },
    guidance: {
      en: "Review required application, inquiries, road-test or equivalent and current driving-record review. Different records have different renewal and retention rules; one upload is not the entire file.",
      es: "Revise solicitud, investigaciones, prueba de manejo o equivalente y revisión vigente del historial. Los registros tienen renovaciones y retenciones distintas; una carga no representa todo el expediente.",
    },
  },
  {
    id: "driver-medical",
    label: {
      en: "Driver medical qualification",
      es: "Calificación médica del conductor",
    },
    category: "driver_medical",
    subjectKinds: ["driver"],
    jurisdiction: "federal",
    applicabilityFact: "medicalRequired",
    expiryRequired: true,
    source: {
      url: "https://www.fmcsa.dot.gov/regulations/medical/medical-regulations-and-guidance-resource-links",
      section:
        "49 CFR Part 391; current medical status and state electronic process",
    },
    guidance: {
      en: "Use the authoritative current qualification and issuing-state process, including electronic status where required. Keep clinical documents private and record the source's actual qualification expiry.",
      es: "Use calificación vigente de fuente autorizada y proceso del estado, incluido estado electrónico cuando corresponda. Mantenga privados documentos clínicos y registre vencimiento real de la fuente.",
    },
  },
  {
    id: "driver-testing",
    label: {
      en: "Testing program and Clearinghouse",
      es: "Programa de pruebas y Clearinghouse",
    },
    category: "driver_testing",
    subjectKinds: ["driver"],
    jurisdiction: "federal",
    applicabilityFact: "testingRequired",
    expiryRequired: false,
    source: {
      url: `${cfr("382")}/subpart-G/section-382.701`,
      section:
        "49 CFR Part 382 and 382.701; consent, queries and prohibited status",
    },
    guidance: {
      en: "Review program applicability, required consent, appropriate current queries and prohibited status using qualified sources. A document receipt or ordinary checkbox is not eligibility verification.",
      es: "Revise aplicabilidad del programa, consentimiento, consultas vigentes y estado de prohibición con fuentes calificadas. Recibir un documento o marcar una casilla no verifica elegibilidad.",
    },
  },
  {
    id: "driver-duty",
    label: {
      en: "Driver duty / hours source",
      es: "Fuente de jornada y horas del conductor",
    },
    category: "duty",
    subjectKinds: ["driver"],
    jurisdiction: "federal",
    applicabilityFact: "hoursRulesApply",
    expiryRequired: true,
    source: {
      url: cfr("395"),
      section:
        "49 CFR Part 395; applicable hours, ELD/log source and specific exceptions",
    },
    guidance: {
      en: "Review a qualified current ELD or log source and exact exception basis. Payroll hours, schedule availability and phone GPS are not an ELD or hours-of-service clearance; no blanket oilfield exemption applies.",
      es: "Revise fuente ELD o bitácora calificada vigente y excepción concreta. Horas de nómina, agenda y GPS telefónico no son ELD ni autorización de servicio; no hay exención petrolera universal.",
    },
  },
].map((row) => ({
  ...row,
  researchedAt: FLEET_COMPLIANCE_RESEARCH_AS_OF,
})) as Array<Reference & { researchedAt: string }>;

export function draftFleetRequirement(
  id: string,
  options: { version: number; effectiveFrom: string },
) {
  const reference = FLEET_REQUIREMENT_TEMPLATES.find((row) => row.id === id);
  if (!reference) throw new Error("Unknown requirement reference");
  return FleetComplianceRequirementAdoptSchema.shape.requirement.parse({
    id: reference.id,
    version: options.version,
    category: reference.category,
    label: reference.label.en,
    subjectKinds: reference.subjectKinds,
    jurisdiction: reference.jurisdiction,
    classification: "legal",
    effectiveFrom: options.effectiveFrom,
    effectiveUntil: null,
    applicability: {
      anyOf: [
        {
          allOf: [
            { fact: reference.applicabilityFact, operator: "eq", value: true },
          ],
        },
      ],
    },
    expiryRequired: reference.expiryRequired,
    renewalDays: null,
    dueSoonDays: 60,
    source: reference.source,
  });
}

/** A successful write is not enough: check both its exact prepared body and a
 * separately fetched immutable revision, including the server's reviewer stamp. */
export function verifyFleetRequirementAdoption(
  prepared: unknown,
  result: unknown,
  readback: unknown,
): FleetRequirementVersion {
  const expected =
    FleetComplianceRequirementAdoptSchema.shape.requirement.parse(prepared);
  const saved = FleetRequirementVersionSchema.parse(result);
  const { reviewedAt: _at, reviewedByUserId: _by, ...source } = saved.source;
  const body = FleetComplianceRequirementAdoptSchema.shape.requirement.parse({
    ...saved,
    source,
  });
  const current = FleetComplianceRequirementsViewSchema.parse(
    readback,
  ).requirements.find(
    (row) => row.id === expected.id && row.version === expected.version,
  );
  if (
    JSON.stringify(body) !== JSON.stringify(expected) ||
    !current ||
    JSON.stringify(current) !== JSON.stringify(saved)
  )
    throw new Error("Requirement revision readback does not match");
  return saved;
}
