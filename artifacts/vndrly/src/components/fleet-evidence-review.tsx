import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FleetComplianceRecordSchema,
  FleetComplianceVerifySchema,
  type FleetComplianceRecord,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";
type Attempt = z.infer<typeof FleetComplianceVerifySchema>;
/** Explicit reviewer interaction only. Private records remain component-local;
 * no React Query/localStorage/cache entry or general purpose JSON editor. */
type Props = {
  identity: string;
  evidenceId: string;
  revision: number;
  onSaved: () => void;
  onClose: () => void;
};
export function FleetEvidenceReview(props: Props) {
  return (
    <EvidenceReviewForm
      key={`${props.identity}:${props.evidenceId}:${props.revision}`}
      {...props}
    />
  );
}
function EvidenceReviewForm({
  identity,
  evidenceId,
  revision,
  onSaved,
  onClose,
}: Props) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    alive = useRef(true),
    originalScope = useRef(identity),
    latestScope = useRef(identity),
    request = useRef<Attempt | null>(null),
    lock = useRef(false);
  latestScope.current = identity;
  const [record, setRecord] = useState<FleetComplianceRecord | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [decision, setDecision] = useState<Attempt["decision"]>("reviewed"),
    [sourceKind, setSourceKind] = useState(""),
    [reference, setReference] = useState(""),
    [url, setUrl] = useState(""),
    [checkedAt, setCheckedAt] = useState<string | null>(null);
  const current = () =>
    alive.current && originalScope.current === latestScope.current;
  useEffect(() => {
    alive.current = true;
    setRecord(null);
    setError("");
    void fleetClient
      .privateComplianceRecord(evidenceId, revision)
      .then((raw) => {
        if (!current()) return;
        const value = FleetComplianceRecordSchema.parse(raw);
        if (
          value.evidence.id !== evidenceId ||
          value.evidence.revision !== revision
        )
          throw new Error("Changed scope");
        setRecord(value);
      })
      .catch(() => {
        if (current())
          setError(
            es
              ? "La evidencia privada no está disponible con sus permisos actuales."
              : "Private evidence is unavailable under your current reviewer access.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, [identity, evidenceId, revision]);
  function prepare() {
    if (!record || busy || !current()) return;
    try {
      if (!checkedAt) throw new Error("Source time required");
      request.current = FleetComplianceVerifySchema.parse({
        operationId: crypto.randomUUID(),
        evidenceId,
        expectedVersion: revision,
        decision,
        source: { kind: sourceKind, reference, url: url.trim() || null },
        reviewedAt: checkedAt,
      });
      setPrepared(true);
      setError("");
    } catch {
      setError(
        es
          ? "Elija la decisión y la fuente, añada una referencia y confirme cuándo consultó la fuente."
          : "Choose a decision and source, add its reference, and confirm when you checked it.",
      );
    }
  }
  async function save() {
    const attempt = request.current;
    if (!attempt || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await fleetClient.reviewCompliance(attempt);
      if (
        receipt.id !== evidenceId ||
        receipt.revision !== attempt.expectedVersion + 1 ||
        receipt.status !== attempt.decision
      )
        throw new Error("Review receipt mismatch");
      const saved = FleetComplianceRecordSchema.parse(
        await fleetClient.privateComplianceRecord(evidenceId, receipt.revision),
      );
      if (
        saved.evidence.id !== evidenceId ||
        saved.evidence.revision !== receipt.revision ||
        saved.evidence.status !== attempt.decision ||
        saved.review?.reportedReviewedAt !== attempt.reviewedAt ||
        JSON.stringify(saved.review?.source) !== JSON.stringify(attempt.source)
      )
        throw new Error("Review needs verification");
      if (current()) {
        request.current = null;
        setUncertain(false);
        setRecord(null);
        onSaved();
      }
    } catch (cause) {
      if (current()) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          request.current = null;
          setRecord(null);
          setPrepared(false);
          setError(
            es
              ? "La evidencia o sus permisos cambiaron. Cierre y actualice antes de volver a revisar."
              : "Evidence or reviewer access changed. Close and reload before reviewing again.",
          );
        } else {
          setUncertain(true);
          setError(
            es
              ? "Debe verificarse el resultado. Reintente la misma revisión antes de realizar otro cambio."
              : "Review outcome needs verification. Retry the same review before making another change.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const attr = record?.attributes;
  const sourceLabels = {
    government_registry: es ? "Registro oficial" : "Government registry",
    qualified_examiner: es ? "Examinador acreditado" : "Qualified examiner",
    insurer_confirmation: es
      ? "Confirmación de aseguradora"
      : "Insurer confirmation",
    qualified_reviewer: es ? "Revisor designado" : "Designated reviewer",
    employer_record: es ? "Registro del empleador" : "Employer record",
    ELD_record: es ? "Registro ELD" : "ELD record",
  };
  const fields: Array<[string, string]> = !attr
    ? []
    : attr.kind === "driver_license"
      ? [
          [es ? "Número de licencia" : "License number", attr.licenseNumber],
          [es ? "Estado emisor" : "Issuing state", attr.issuingState],
          [es ? "Clase" : "Class", attr.licenseClass],
          [es ? "Endosos" : "Endorsements", attr.endorsements.join(", ")],
          [es ? "Restricciones" : "Restrictions", attr.restrictions.join(", ")],
          [es ? "Estado registrado" : "Recorded status", attr.licenseStatus],
        ]
      : attr.kind === "insurance"
        ? [
            [es ? "Póliza" : "Policy", attr.coverage.policyNumber],
            [
              es ? "Entidad asegurada" : "Insured entity",
              attr.coverage.insuredLegalEntity,
            ],
            [
              es ? "Tipo de cobertura" : "Coverage type",
              attr.coverage.coverageType,
            ],
            [es ? "Límite USD" : "USD limit", attr.coverage.limitUSD],
            [
              es ? "Territorios" : "Territories",
              attr.coverage.states?.join(", ") ?? "—",
            ],
            [
              es ? "Carga" : "Cargo",
              attr.coverage.cargoCodes?.join(", ") ?? "—",
            ],
          ]
        : attr.kind === "credential"
          ? [
              [es ? "Credencial" : "Credential", attr.credentialType],
              [es ? "Referencia" : "Reference", attr.reference ?? "—"],
              [
                es ? "Autoridad emisora" : "Issuing authority",
                attr.issuingAuthority,
              ],
            ]
          : attr.kind === "driver_medical"
            ? [
                [
                  es ? "Aptitud registrada" : "Recorded qualification",
                  attr.qualification,
                ],
                [
                  es ? "Referencia del examinador" : "Examiner reference",
                  attr.examinerReference ?? "—",
                ],
                [
                  es ? "Restricciones" : "Restrictions",
                  attr.restrictions.join(", "),
                ],
              ]
            : attr.kind === "driver_testing"
              ? [
                  [es ? "Programa" : "Program", attr.program],
                  [
                    es ? "Resultado registrado" : "Recorded result",
                    attr.result,
                  ],
                  [
                    es ? "Consulta" : "Query reference",
                    attr.queryReference ?? "—",
                  ],
                ]
              : attr.kind === "driver_qualification"
                ? [
                    [es ? "Comprobación" : "Check", attr.check],
                    [
                      es ? "Resultado registrado" : "Recorded result",
                      attr.result,
                    ],
                    [
                      es ? "Referencia" : "Reference",
                      attr.sourceRecordId ?? "—",
                    ],
                  ]
                : [
                    [es ? "Fuente de horas" : "Duty source", attr.source],
                    [es ? "Estado de horas" : "Duty status", attr.dutyStatus],
                    [es ? "Fecha de origen" : "Source time", attr.asOf],
                  ];
  return (
    <section
      className="fleet-detail-group space-y-3"
      aria-label={
        es ? "Revisión privada de evidencia" : "Private evidence review"
      }
    >
      <h3>
        {es ? "Revisión privada de evidencia" : "Private evidence review"}
      </h3>
      {!!error && <p role="alert">{error}</p>}
      {record && (
        <>
          <dl>
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <p>
            {es
              ? "Una revisión no cambia el documento ni demuestra cobertura para todos los recorridos."
              : "Review does not alter the document or establish coverage for every Run."}
          </p>
          <fieldset disabled={busy || prepared} className="space-y-3">
            <label>
              {es ? "Decisión de revisión" : "Review decision"}
              <select
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as Attempt["decision"])
                }
              >
                {(["reviewed", "verified", "revoked", "failed"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {es
                        ? {
                            reviewed: "Revisado",
                            verified: "Verificado",
                            revoked: "Revocado",
                            failed: "Incumplido",
                          }[value]
                        : value}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {es ? "Fuente de verificación" : "Verification source"}
              <select
                value={sourceKind}
                onChange={(event) => setSourceKind(event.target.value)}
              >
                <option value="">
                  {es ? "Elija una fuente" : "Choose source"}
                </option>
                {Object.entries(sourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {es ? "Referencia de la fuente" : "Source reference"}
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                maxLength={500}
              />
            </label>
            <label>
              {es ? "Enlace de la fuente (opcional)" : "Source link (optional)"}
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <PngPillButton
              onClick={() => setCheckedAt(new Date().toISOString())}
            >
              {es ? "Consulté esta fuente ahora" : "I checked this source now"}
            </PngPillButton>
            {checkedAt && (
              <p>
                {new Date(checkedAt).toLocaleString(es ? "es-US" : "en-US")}
              </p>
            )}
          </fieldset>
          {prepared ? (
            <>
              <p>
                {es
                  ? "Revise la decisión y la fuente antes de guardarlas."
                  : "Review this exact decision and source before saving."}
              </p>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {uncertain
                  ? es
                    ? "Reintentar la misma revisión"
                    : "Retry the same evidence review"
                  : es
                    ? "Guardar revisión"
                    : "Save evidence review"}
              </PngPillButton>
              {!uncertain && (
                <PngPillButton
                  disabled={busy}
                  onClick={() => {
                    request.current = null;
                    setPrepared(false);
                  }}
                >
                  {es ? "Editar revisión" : "Edit review"}
                </PngPillButton>
              )}
            </>
          ) : (
            <PngPillButton disabled={busy} onClick={prepare}>
              {es ? "Preparar revisión" : "Prepare evidence review"}
            </PngPillButton>
          )}
        </>
      )}
      <PngPillButton
        disabled={busy}
        onClick={() => {
          setRecord(null);
          onClose();
        }}
      >
        {es ? "Cerrar revisión privada" : "Close private review"}
      </PngPillButton>
    </section>
  );
}
