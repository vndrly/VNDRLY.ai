import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FleetComplianceFactsSchema,
  FleetComplianceFactsSaveSchema,
  FleetComplianceFactsViewSchema,
  fleetComplianceSubjectKey,
  type FleetComplianceSubject,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { BrandedCheckbox } from "./branded-checkbox";
import { PngPillButton } from "./png-pill-rollover";
type Facts = z.infer<typeof FleetComplianceFactsSchema>;
type Attempt = z.infer<typeof FleetComplianceFactsSaveSchema>;
type Props = {
  identity: string;
  subject: FleetComplianceSubject;
  onSaved: () => void;
  onClose: () => void;
};
export function FleetComplianceFactsEditor(props: Props) {
  return (
    <FactsForm
      key={`${props.identity}:${fleetComplianceSubjectKey(props.subject)}`}
      {...props}
    />
  );
}
function FactsForm({ subject, onSaved, onClose }: Props) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    alive = useRef(true),
    attempt = useRef<Attempt | null>(null),
    lock = useRef(false);
  const [facts, setFacts] = useState<Facts>({}),
    [version, setVersion] = useState(0),
    [ready, setReady] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [prepared, setPrepared] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState(""),
    [reference, setReference] = useState(""),
    [url, setUrl] = useState(""),
    [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    alive.current = true;
    void Promise.all([
      fleetClient.complianceFacts(subject),
      fleetClient.complianceRequirements(),
    ])
      .then(([saved, rules]) => {
        if (!alive.current) return;
        if (
          saved &&
          fleetComplianceSubjectKey(saved.subject) !==
            fleetComplianceSubjectKey(subject)
        )
          throw new Error("Subject changed.");
        setFacts(saved?.facts ?? {});
        setVersion(saved?.version ?? 0);
        setCanEdit(rules.canAdopt);
        setReady(true);
      })
      .catch(() => {
        if (alive.current)
          setError(
            es
              ? "Los hechos no están disponibles con sus permisos actuales."
              : "Applicability facts are unavailable under your current access.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const booleanFields = [
    ["interstate", es ? "Comercio interestatal" : "Interstate commerce"],
    ["forHire", es ? "Transporte por contrato" : "For-hire operation"],
    ["cmv", es ? "Vehículo comercial" : "Commercial motor vehicle"],
    ["usdotRequired", es ? "Se requiere registro USDOT" : "USDOT registration required"],
    ["txCarrierRegistrationRequired", es ? "Se requiere registro de transportista de Texas" : "Texas carrier registration required"],
    ["okCarrierAuthorityRequired", es ? "Se requiere autorización de transportista de Oklahoma" : "Oklahoma carrier authority required"],
    ["periodicInspectionRequired", es ? "Se requiere inspección periódica" : "Periodic inspection required"],
    ["driverQualificationRequired", es ? "Se requiere expediente de calificación" : "Driver qualification file required"],
    [
      "cdlRequired",
      es ? "CDL requerido para este trabajo" : "CDL required for this work",
    ],
    [
      "medicalRequired",
      es ? "Certificación médica requerida" : "Medical certification required",
    ],
    [
      "testingRequired",
      es ? "Programa de pruebas requerido" : "Testing program required",
    ],
    ["hoursRulesApply", es ? "Aplican reglas de horas" : "Hours rules apply"],
    ["tankRequired", es ? "Aplicabilidad de tanque" : "Tank applicability"],
    [
      "placarded",
      es
        ? "Placas de materiales peligrosos requeridas"
        : "Hazardous-material placards required",
    ],
  ] as const;
  const numberFields = [
    [
      "gvwrLb",
      es ? "Peso bruto nominal (lb)" : "Gross vehicle weight rating (lb)",
    ],
    [
      "gcwrLb",
      es
        ? "Peso combinado nominal (lb)"
        : "Gross combination weight rating (lb)",
    ],
    [
      "trailerGvwrLb",
      es ? "Peso nominal del remolque (lb)" : "Trailer weight rating (lb)",
    ],
    ["passengers", es ? "Capacidad de pasajeros" : "Passenger capacity"],
  ] as const;
  const textFields = [
    ["state", es ? "Estado en esta evaluación" : "State in this assessment"],
    [
      "cargoCode",
      es ? "Clasificación revisada de carga" : "Reviewed cargo classification",
    ],
    [
      "hazmatClass",
      es
        ? "Clase revisada de material peligroso"
        : "Reviewed hazardous-material class",
    ],
  ] as const;
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
  function prepare() {
    if (!ready || !canEdit || busy) return;
    try {
      if (!reviewed) throw new Error("Source review required");
      attempt.current = FleetComplianceFactsSaveSchema.parse({
        operationId: crypto.randomUUID(),
        expectedVersion: version,
        subject,
        facts,
        source: { kind, reference, url: url.trim() || null },
      });
      setPrepared(true);
      setError("");
    } catch {
      setError(
        es
          ? "Revise los valores y confirme una fuente con referencia. Un campo vacío permanece desconocido."
          : "Review the values and confirm a referenced source. Blank fields remain unknown.",
      );
    }
  }
  async function save() {
    if (!attempt.current || lock.current) return;
    const body = attempt.current;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await fleetClient.saveComplianceFacts(body);
      if (receipt.version !== body.expectedVersion + 1)
        throw new Error("Unexpected revision");
      const saved = FleetComplianceFactsViewSchema.parse(
        await fleetClient.complianceFacts(subject, receipt.version),
      );
      if (
        fleetComplianceSubjectKey(saved.subject) !==
          fleetComplianceSubjectKey(subject) ||
        saved.version !== receipt.version ||
        saved.sourceKind !== body.source.kind ||
        JSON.stringify(saved.facts) !== JSON.stringify(body.facts)
      )
        throw new Error("Fact revision needs verification");
      if (alive.current) {
        attempt.current = null;
        setPrepared(false);
        setUncertain(false);
        onSaved();
      }
    } catch (cause) {
      if (alive.current) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          attempt.current = null;
          setReady(false);
          setCanEdit(false);
          setError(
            es
              ? "Los hechos o sus permisos cambiaron. Cierre y actualice antes de editar."
              : "Facts or permissions changed. Close and reload before editing.",
          );
        } else {
          setUncertain(true);
          setError(
            es
              ? "Debe verificarse el guardado. Reintente los mismos hechos."
              : "Applicability save needs verification. Retry the same facts.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="fleet-detail-group space-y-3"
      aria-label={es ? "Hechos de aplicabilidad" : "Applicability facts"}
    >
      <h3>{es ? "Hechos de aplicabilidad" : "Applicability facts"}</h3>
      <p>
        {es
          ? "Desconocido no significa que un requisito no aplique. Estos hechos operativos no incluyen diagnósticos ni resultados médicos privados."
          : "Unknown does not mean a requirement is inapplicable. These operational facts exclude private clinical and test results."}
      </p>
      {!!error && <p role="alert">{error}</p>}
      {ready && (
        <>
          <fieldset
            disabled={!canEdit || prepared || busy}
            className="grid gap-3 md:grid-cols-2"
          >
            {booleanFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  value={
                    facts[key] === true
                      ? "yes"
                      : facts[key] === false
                        ? "no"
                        : ""
                  }
                  onChange={(event) =>
                    setFacts((prior) => ({
                      ...prior,
                      [key]:
                        event.target.value === ""
                          ? null
                          : event.target.value === "yes",
                    }))
                  }
                >
                  <option value="">{es ? "Desconocido" : "Unknown"}</option>
                  <option value="yes">{es ? "Sí" : "Yes"}</option>
                  <option value="no">{es ? "No" : "No"}</option>
                </select>
              </label>
            ))}
            {numberFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={facts[key] ?? ""}
                  onChange={(event) =>
                    setFacts((prior) => ({
                      ...prior,
                      [key]:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
            {textFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={facts[key] ?? ""}
                  maxLength={key === "state" ? 2 : 500}
                  onChange={(event) =>
                    setFacts((prior) => ({
                      ...prior,
                      [key]: event.target.value.trim()
                        ? key === "state"
                          ? event.target.value.toUpperCase()
                          : event.target.value
                        : null,
                    }))
                  }
                />
              </label>
            ))}
          </fieldset>
          {canEdit && (
            <>
              <fieldset disabled={prepared || busy} className="space-y-3">
                <label>
                  {es ? "Fuente de verificación" : "Verification source"}
                  <select
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="">
                      {es ? "Elija una fuente" : "Choose source"}
                    </option>
                    {Object.entries(sourceLabels).map(([id, label]) => (
                      <option key={id} value={id}>
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
                  {es
                    ? "Enlace de la fuente (opcional)"
                    : "Source link (optional)"}
                  <input
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <BrandedCheckbox
                    aria-label={
                      es
                        ? "Revisé estos hechos con esta fuente"
                        : "I reviewed these facts against this source"
                    }
                    checked={reviewed}
                    onCheckedChange={(checked) => setReviewed(checked === true)}
                  />
                  {es
                    ? "Revisé estos hechos con esta fuente"
                    : "I reviewed these facts against this source"}
                </label>
              </fieldset>
              {prepared ? (
                <>
                  <PngPillButton disabled={busy} onClick={() => void save()}>
                    {uncertain
                      ? es
                        ? "Reintentar los mismos hechos"
                        : "Retry the same applicability facts"
                      : es
                        ? "Guardar hechos de aplicabilidad"
                        : "Save applicability facts"}
                  </PngPillButton>
                  {!uncertain && (
                    <PngPillButton
                      disabled={busy}
                      onClick={() => {
                        attempt.current = null;
                        setPrepared(false);
                      }}
                    >
                      {es ? "Editar hechos" : "Edit facts"}
                    </PngPillButton>
                  )}
                </>
              ) : (
                <PngPillButton disabled={busy} onClick={prepare}>
                  {es
                    ? "Preparar hechos de aplicabilidad"
                    : "Prepare applicability facts"}
                </PngPillButton>
              )}
            </>
          )}
        </>
      )}
      <PngPillButton disabled={busy} onClick={onClose}>
        {es ? "Cerrar hechos de aplicabilidad" : "Close applicability facts"}
      </PngPillButton>
    </section>
  );
}
