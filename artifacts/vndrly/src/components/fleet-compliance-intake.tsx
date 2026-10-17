import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createFleetComplianceSourceDraft,
  updateFleetComplianceSourceDraft,
  verifyFleetComplianceSourceReceipt,
  fleetComplianceSourceFields,
  fleetComplianceSourceChoiceLabel,
  fleetComplianceSourceSupportsRequirement,
  FLEET_COMPLIANCE_SOURCE_KINDS,
  FleetCoverageTypeSchema,
  FleetComplianceSaveSchema,
  fleetComplianceSubjectKey,
  type FleetComplianceSubject,
  type FleetRequirementVersion,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient, FleetRequestError } from "@/lib/fleet-client";
import { BrandedCheckbox } from "./branded-checkbox";
import { PngPillButton } from "./png-pill-rollover";
type SourceKind = keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS;
type FileSource = {
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bodyBase64: string;
  size: number;
};
type Attempt = {
  command: z.infer<typeof FleetComplianceSaveSchema>;
  upload:
    | ({
        operationId: string;
        recordId: string;
        subject: FleetComplianceSubject;
      } & Omit<FileSource, "size">)
    | null;
};
type Choice = {
  subject: FleetComplianceSubject;
  label: string;
  canSubmit: boolean;
};
export function FleetComplianceIntake(props: {
  identity: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  return <Intake key={props.identity} {...props} />;
}
function Intake({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const { i18n } = useTranslation(),
    lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es")
      ? "es"
      : "en",
    say = (en: string, es: string) => (lang === "es" ? es : en);
  const [kind, setKind] = useState<FleetComplianceSubject["kind"]>("driver"),
    [search, setSearch] = useState(""),
    [choices, setChoices] = useState<Choice[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [selection, setSelection] = useState("");
  const [rules, setRules] = useState<FleetRequirementVersion[]>([]),
    [rule, setRule] = useState(""),
    [type, setType] = useState<SourceKind | "">(""),
    [coverageType, setCoverageType] = useState(""),
    [source, setSource] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({});
  const [document, setDocument] = useState<FileSource | null>(null),
    [reading, setReading] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [affirmed, setAffirmed] = useState(false),
    [error, setError] = useState(""),
    [fatal, setFatal] = useState(false),
    [done, setDone] = useState(false);
  const alive = useRef(true),
    epoch = useRef(0),
    lock = useRef(false),
    attempt = useRef<Attempt | null>(null);
  const selected = choices.find(
    (row) => fleetComplianceSubjectKey(row.subject) === selection,
  );
  useEffect(() => {
    alive.current = true;
    void fleetClient
      .complianceRequirements()
      .then((data) => {
        if (alive.current) setRules(data.requirements);
      })
      .catch(() => {
        if (alive.current)
          setError(
            say(
              "Requirement references unavailable. A received source can remain unmapped.",
              "Referencias no disponibles. Una fuente recibida puede quedar sin asignar.",
            ),
          );
      });
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, []);
  async function load(more = false) {
    const token = ++epoch.current;
    setLoading(true);
    if (!more) {
      setChoices([]);
      setAfter(null);
    }
    try {
      const page = await fleetClient.complianceSubjects({
        kind,
        search,
        ...(more && after ? { after } : {}),
      });
      if (!alive.current || token !== epoch.current) return;
      setChoices((prior) =>
        more ? [...prior, ...page.entries] : page.entries,
      );
      setAfter(page.nextCursor);
    } catch {
      if (alive.current && token === epoch.current) {
        setChoices([]);
        setAfter(null);
        setError(
          say(
            "Source subjects unavailable. Reload to check access.",
            "Sujetos no disponibles. Vuelva a cargar para comprobar acceso.",
          ),
        );
      }
    } finally {
      if (alive.current && token === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [kind, search]);
  function reset() {
    setSelection("");
    setType("");
    setCoverageType("");
    setSource("");
    setFields({});
    setDocument(null);
    setRule("");
    setAffirmed(false);
    setDone(false);
    setError("");
  }
  async function fileChanged(file: File | undefined) {
    if (!file) {
      setDocument(null);
      return;
    }
    const token = epoch.current;
    setReading(true);
    setError("");
    try {
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("size");
      const bodyBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read"));
        reader.onload = () => {
          const value = reader.result;
          if (typeof value !== "string" || !value.includes(","))
            reject(new Error("read"));
          else resolve(value.slice(value.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
      });
      const prefix = atob(bodyBase64.slice(0, 24)),
        bytes = Array.from(prefix, (c) => c.charCodeAt(0));
      let contentType: FileSource["contentType"];
      if (prefix.startsWith("%PDF-")) contentType = "application/pdf";
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        contentType = "image/jpeg";
      else if (
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, index) => bytes[index] === byte,
        )
      )
        contentType = "image/png";
      else if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP")
        contentType = "image/webp";
      else throw new Error("type");
      if (alive.current && token === epoch.current)
        setDocument({ bodyBase64, contentType, size: file.size });
    } catch {
      if (alive.current && token === epoch.current) {
        setDocument(null);
        setError(
          say(
            "Choose a readable PDF, JPEG, PNG or WebP source up to 10 MiB.",
            "Elija PDF, JPEG, PNG o WebP legible de hasta 10 MiB.",
          ),
        );
      }
    } finally {
      if (alive.current) setReading(false);
    }
  }
  const latest = new Map<string, FleetRequirementVersion>();
  for (const row of rules)
    if (
      row.subjectKinds.includes(kind) &&
      type &&
      fleetComplianceSourceSupportsRequirement(type, row.category) &&
      (!latest.has(row.id) || latest.get(row.id)!.version < row.version)
    )
      latest.set(row.id, row);
  function prepare() {
    if (!selected?.canSubmit || !type || !affirmed || busy || reading || fatal)
      return;
    try {
      const requirement = rule ? latest.get(rule) : undefined;
      if (rule && !requirement) throw new Error("Requirement selection changed");
      const id = crypto.randomUUID(),
        draft = createFleetComplianceSourceDraft({
          id,
          subject: selected.subject,
          kind: type,
          source: source.trim() || (document ? "User provided document" : ""),
          at: new Date().toISOString(),
          ...(requirement ? { requirement: { id:requirement.id,version:requirement.version,label:requirement.label } } : {}),
          ...(type === "insurance"
            ? { coverageType: FleetCoverageTypeSchema.parse(coverageType) }
            : {}),
        });
      const record = updateFleetComplianceSourceDraft(draft, fields);
      attempt.current = {
        command: FleetComplianceSaveSchema.parse({
          operationId: crypto.randomUUID(),
          expectedVersion: 0,
          record,
        }),
        upload: document
          ? {
              operationId: crypto.randomUUID(),
              recordId: id,
              subject: selected.subject,
              bodyBase64: document.bodyBase64,
              contentType: document.contentType,
            }
          : null,
      };
      setPrepared(true);
      setUncertain(false);
      setError("");
    } catch {
      setError(
        say(
          "Check the source fields and any supplied dates. Blank optional fields stay unknown.",
          "Revise campos y fechas proporcionadas. Los campos opcionales vacíos permanecen desconocidos.",
        ),
      );
    }
  }
  async function save() {
    const work = attempt.current;
    if (!alive.current || !work || lock.current || fatal) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (work.upload && !work.command.record.evidence.privateDocumentRef) {
        const uploaded = await fleetClient.uploadComplianceDocument(
          work.upload,
        );
        if (!alive.current) return;
        const record = work.command.record;
        work.command = FleetComplianceSaveSchema.parse({
          ...work.command,
          record: {
            ...record,
            evidence: {
              ...record.evidence,
              privateDocumentRef: uploaded.objectPath,
            },
            attributes:
              record.attributes.kind === "insurance"
                ? {
                    ...record.attributes,
                    coverage: {
                      ...record.attributes.coverage,
                      privateDocumentRef: uploaded.objectPath,
                    },
                  }
                : record.attributes,
          },
        });
      }
      const received = await fleetClient.receiveComplianceSource(work.command);
      if (!alive.current) return;
      const canonical = await fleetClient.complianceReceipt(
        work.command.record.evidence.id,
        work.command.record.evidence.revision,
      );
      verifyFleetComplianceSourceReceipt(
        work.command.record,
        received,
        canonical,
      );
      if (!alive.current) return;
      attempt.current = null;
      setPrepared(false);
      setUncertain(false);
      setDocument(null);
      setFields({});
      setSource("");
      setDone(true);
      onSaved();
    } catch (reason) {
      if (!alive.current) return;
      if (
        reason instanceof FleetRequestError &&
        reason.status >= 400 &&
        reason.status < 500
      ) {
        setFatal(true);
        attempt.current = null;
        setFields({});
        setDocument(null);
        setSource("");
        setError(
          say(
            "Access or source revision changed. Close and reload before another change.",
            "Cambió el acceso o la revisión. Cierre y vuelva a cargar antes de cambiar.",
          ),
        );
      } else {
        setUncertain(true);
        setError(
          say(
            "Source save needs verification. Retry the same received evidence.",
            "Debe verificarse el guardado. Reintente la misma evidencia recibida.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = prepared || busy || reading || fatal;
  const subjects = {
    carrier: say("Carrier & insurance", "Transportista y seguros"),
    driver: say("Drivers", "Conductores"),
    vehicle: say("Vehicles", "Vehículos"),
    component: say("Components & tanks", "Componentes y tanques"),
    trip: say("Trip documents", "Documentos del viaje"),
  };
  const sourceTypes = (
    Object.keys(FLEET_COMPLIANCE_SOURCE_KINDS) as SourceKind[]
  ).filter((value) =>
    kind === "driver"
      ? value !== "insurance"
      : kind === "carrier"
        ? ["insurance", "credential"].includes(value)
        : value === "credential",
  );
  const defaults: Record<string, string> = {
    licenseStatus: "unverified",
    qualification: "unverified",
    result: "unverified",
    check: "DQ_file",
    dutySource: "unavailable",
    dutyStatus: "unknown",
  };
  return (
    <section
      className="fleet-detail-group space-y-3"
      aria-label={say(
        "Receive compliance evidence",
        "Recibir evidencia de cumplimiento",
      )}
    >
      <h3>
        {say(
          "Receive compliance evidence",
          "Recibir evidencia de cumplimiento",
        )}
      </h3>
      <p>
        {say(
          "This records a private, unverified source. It does not certify eligibility, coverage or a filing. Unknown details can be reviewed later.",
          "Esto registra una fuente privada sin verificar. No certifica elegibilidad, cobertura ni presentación. Los datos desconocidos pueden revisarse después.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {done && (
        <p role="status">
          {say(
            "Evidence received — awaiting review.",
            "Evidencia recibida — pendiente de revisión.",
          )}
        </p>
      )}
      {!fatal && !done && (
        <>
          <label>
            {say("Resource category", "Categoría de recurso")}
            <select
              disabled={disabled}
              value={kind}
              onChange={(e) => {
                reset();
                setKind(e.target.value as typeof kind);
              }}
            >
              {Object.entries(subjects).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {say("Search people or assets", "Buscar personas o activos")}
            <input
              disabled={disabled}
              value={search}
              onChange={(e) => {
                reset();
                setSearch(e.target.value);
              }}
            />
          </label>
          <label>
            {say("For", "Para")}
            <select
              disabled={disabled || loading}
              value={selection}
              onChange={(e) => {
                setSelection(e.target.value);
                setFields({});
                setDocument(null);
                setAffirmed(false);
              }}
            >
              <option value="">
                {say(
                  "Choose a company resource",
                  "Elija un recurso de la empresa",
                )}
              </option>
              {choices.map((row) => (
                <option
                  key={fleetComplianceSubjectKey(row.subject)}
                  value={fleetComplianceSubjectKey(row.subject)}
                >
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          {after && (
            <PngPillButton
              disabled={disabled || loading}
              onClick={() => void load(true)}
            >
              {say(
                "Load more people or assets",
                "Cargar más personas o activos",
              )}
            </PngPillButton>
          )}
          {selected && !selected.canSubmit && (
            <p>
              {say(
                "Your current access allows viewing this resource; source submission is unavailable.",
                "Su acceso permite ver este recurso; no está disponible enviar fuentes.",
              )}
            </p>
          )}
          {selected?.canSubmit && (
            <>
              <label>
                {say("Source type", "Tipo de fuente")}
                <select
                  disabled={disabled}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as SourceKind);
                    setRule("");
                    setFields({});
                    setAffirmed(false);
                  }}
                >
                  <option value="">
                    {say("Choose source type", "Elija tipo de fuente")}
                  </option>
                  {sourceTypes.map((value) => (
                    <option key={value} value={value}>
                      {FLEET_COMPLIANCE_SOURCE_KINDS[value][lang]}
                    </option>
                  ))}
                </select>
              </label>
              {type && (
                <>
                  {type === "insurance" && (
                    <label>
                      {say("Coverage category", "Categoría de cobertura")}
                      <select
                        disabled={disabled}
                        value={coverageType}
                        onChange={(e) => setCoverageType(e.target.value)}
                      >
                        <option value="">
                          {say(
                            "Choose coverage category",
                            "Elija categoría de cobertura",
                          )}
                        </option>
                        {FleetCoverageTypeSchema.options.map((value) => (
                          <option key={value} value={value}>
                            {fleetComplianceSourceChoiceLabel(value, lang)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    {say("Adopted requirement", "Requisito adoptado")}
                    <select
                      disabled={disabled}
                      value={rule}
                      onChange={(e) => setRule(e.target.value)}
                    >
                      <option value="">
                        {say(
                          "Unmapped source — keep for review",
                          "Fuente sin asignar — conservar para revisión",
                        )}
                      </option>
                      {Array.from(latest.values()).map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label} · {row.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {say(
                      "Source reference or description",
                      "Referencia o descripción de fuente",
                    )}
                    <input
                      disabled={disabled}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      maxLength={500}
                    />
                  </label>
                  <label>
                    {say("Source document", "Documento fuente")}
                    <input
                      type="file"
                      disabled={disabled}
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => void fileChanged(e.target.files?.[0])}
                    />
                  </label>
                  {document && (
                    <p>
                      {say(
                        "Source document ready",
                        "Documento fuente preparado",
                      )}{" "}
                      · {document.size.toLocaleString()}{" "}
                      {say("bytes; not yet uploaded", "bytes; aún no cargado")}
                    </p>
                  )}
                  <p>
                    {say(
                      "Optional source details. Enter only what the source actually states; leave unread fields blank.",
                      "Datos opcionales de la fuente. Ingrese solo lo que indica; deje vacíos los datos ilegibles.",
                    )}
                  </p>
                  {fleetComplianceSourceFields(type).map((field) => (
                    <label key={field.key}>
                      {field.label[lang]}
                      {field.options ? (
                        <select
                          disabled={disabled}
                          value={fields[field.key] ?? defaults[field.key] ?? ""}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              [field.key]: e.target.value,
                            })
                          }
                        >
                          <option value="">
                            {say("Unknown", "Desconocido")}
                          </option>
                          {field.options.map((value) => (
                            <option key={value} value={value}>
                              {fleetComplianceSourceChoiceLabel(value, lang)}
                            </option>
                          ))}
                        </select>
                      ) : field.multiline ? (
                        <textarea
                          disabled={disabled}
                          value={fields[field.key] ?? ""}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <input
                          disabled={disabled}
                          value={fields[field.key] ?? ""}
                          maxLength={500}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                  <label className="flex items-center gap-2">
                    <BrandedCheckbox
                      disabled={disabled}
                      checked={affirmed}
                      onCheckedChange={(value) => setAffirmed(value === true)}
                    />
                    {say(
                      "Save this as received, unverified evidence",
                      "Guardar como evidencia recibida sin verificar",
                    )}
                  </label>
                  {!prepared ? (
                    <PngPillButton
                      disabled={!affirmed || disabled}
                      onClick={prepare}
                    >
                      {say("Prepare source", "Preparar fuente")}
                    </PngPillButton>
                  ) : (
                    <>
                      <p>
                        {selected.label} ·{" "}
                        {FLEET_COMPLIANCE_SOURCE_KINDS[type][lang]} ·{" "}
                        {say(
                          "Document received only",
                          "Solo documento recibido",
                        )}
                      </p>
                      <PngPillButton
                        disabled={busy}
                        onClick={() => void save()}
                      >
                        {uncertain
                          ? say(
                              "Retry the same received evidence",
                              "Reintentar la misma evidencia recibida",
                            )
                          : say(
                              "Save received evidence",
                              "Guardar evidencia recibida",
                            )}
                      </PngPillButton>
                      {!uncertain && (
                        <PngPillButton
                          disabled={busy}
                          onClick={() => {
                            attempt.current = null;
                            setPrepared(false);
                          }}
                        >
                          {say("Edit source", "Editar fuente")}
                        </PngPillButton>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <PngPillButton disabled={busy || reading} onClick={onClose}>
        {say("Close source", "Cerrar fuente")}
      </PngPillButton>
    </section>
  );
}
