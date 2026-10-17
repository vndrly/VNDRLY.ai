import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
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
  FleetComplianceRequirementsViewSchema,
  FleetComplianceSubjectChoicesPageSchema,
  FleetComplianceDocumentReceiptSchema,
  fleetComplianceSubjectKey,
  type FleetComplianceSubject,
  type FleetRequirementVersion,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  pickWorkDocumentDraft,
  readWorkDocumentDraft,
} from "@/lib/native-work-capture";
import { useColors } from "@/hooks/useColors";
import FleetChoiceField from "./FleetChoiceField";
import FleetCheckbox from "./FleetCheckbox";
import TogglePillButton from "./TogglePillButton";
type SourceKind = keyof typeof FLEET_COMPLIANCE_SOURCE_KINDS;
type SourceFile = {
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bodyBase64: string;
  size: number;
  fileId: string;
  sha256: string;
};
type Attempt = {
  command: z.infer<typeof FleetComplianceSaveSchema>;
  upload: {
    operationId: string;
    recordId: string;
    subject: FleetComplianceSubject;
    contentType: SourceFile["contentType"];
    bodyBase64: string;
  } | null;
};
type Choice = {
  subject: FleetComplianceSubject;
  label: string;
  canSubmit: boolean;
};
type Props = { onSaved: () => void; onClose: () => void };
export default function FleetComplianceIntake(props: Props) {
  return <Intake key={captureAuthScope().generation} {...props} />;
}
function Intake({ onSaved, onClose }: Props) {
  const colors = useColors(),
    { i18n } = useTranslation(),
    lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es")
      ? "es"
      : "en",
    say = (en: string, es: string) => (lang === "es" ? es : en);
  const scope = useRef(captureAuthScope()),
    alive = useRef(true),
    epoch = useRef(0),
    lock = useRef(false),
    attempt = useRef<Attempt | null>(null),
    current = () => alive.current && isAuthScopeCurrent(scope.current);
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
  const [document, setDocument] = useState<SourceFile | null>(null),
    [reading, setReading] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [affirmed, setAffirmed] = useState(false),
    [error, setError] = useState(""),
    [fatal, setFatal] = useState(false),
    [done, setDone] = useState(false);
  const selected = choices.find(
    (row) => fleetComplianceSubjectKey(row.subject) === selection,
  );
  useEffect(() => {
    alive.current = true;
    void apiFetch<unknown>(
      "/api/fleet/compliance/requirements",
      {},
      scope.current,
    )
      .then((raw) => {
        if (current())
          setRules(
            FleetComplianceRequirementsViewSchema.parse(raw).requirements,
          );
      })
      .catch(() => {
        if (current())
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
    if (!current()) return;
    const token = ++epoch.current;
    setLoading(true);
    if (!more) {
      setChoices([]);
      setAfter(null);
    }
    try {
      const query = new URLSearchParams({ kind, search });
      if (more && after) query.set("after", after);
      const page = FleetComplianceSubjectChoicesPageSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/compliance/subjects?${query}`,
          {},
          scope.current,
        ),
      );
      if (!current() || token !== epoch.current) return;
      setChoices((prior) =>
        more ? [...prior, ...page.entries] : page.entries,
      );
      setAfter(page.nextCursor);
    } catch {
      if (current() && token === epoch.current) {
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
      if (current() && token === epoch.current) setLoading(false);
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
  async function chooseDocument() {
    if (!current() || reading) return;
    const token = epoch.current;
    setReading(true);
    setError("");
    try {
      const picked = await pickWorkDocumentDraft();
      if (!current() || token !== epoch.current) return;
      const body = await readWorkDocumentDraft(picked);
      if (current() && token === epoch.current)
        setDocument({
          bodyBase64: body.bodyBase64,
          contentType: body.contentType,
          size: body.byteSize,
          fileId: body.fileId,
          sha256: body.sha256,
        });
    } catch {
      if (current() && token === epoch.current)
        setError(
          say(
            "Choose a readable PDF, JPEG, PNG or WebP source up to 10 MiB. If this app version has no system picker, install the current native build.",
            "Elija PDF, JPEG, PNG o WebP legible de hasta 10 MiB. Si esta versión no tiene selector, instale la versión nativa actual.",
          ),
        );
    } finally {
      if (current()) setReading(false);
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
    if (
      !current() ||
      !selected?.canSubmit ||
      !type ||
      !affirmed ||
      busy ||
      reading ||
      fatal
    )
      return;
    try {
      const requirement = rule ? latest.get(rule) : undefined;
      if (rule && !requirement) throw new Error("Requirement selection changed");
      const id = Crypto.randomUUID(),
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
          operationId: Crypto.randomUUID(),
          expectedVersion: 0,
          record,
        }),
        upload: document
          ? {
              operationId: Crypto.randomUUID(),
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
    if (!current() || !work || lock.current || fatal) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (work.upload && !work.command.record.evidence.privateDocumentRef) {
        const uploaded = FleetComplianceDocumentReceiptSchema.parse(
          await apiFetch<unknown>(
            "/api/fleet/compliance/documents",
            { method: "POST", body: JSON.stringify(work.upload) },
            scope.current,
          ),
        );
        if (!current()) return;
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
      const received = await apiFetch<unknown>(
        "/api/fleet/compliance",
        { method: "POST", body: JSON.stringify(work.command) },
        scope.current,
      );
      if (!current()) return;
      const canonical = await apiFetch<unknown>(
        `/api/fleet/compliance/${work.command.record.evidence.id}/receipt?revision=${work.command.record.evidence.revision}`,
        {},
        scope.current,
      );
      verifyFleetComplianceSourceReceipt(
        work.command.record,
        received,
        canonical,
      );
      if (!current()) return;
      attempt.current = null;
      setPrepared(false);
      setUncertain(false);
      setDocument(null);
      setFields({});
      setSource("");
      setDone(true);
      onSaved();
    } catch (reason) {
      if (!current()) return;
      const status = (reason as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
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
      if (current()) setBusy(false);
    }
  }
  if (!current()) return null;
  const disabled = prepared || busy || reading || fatal,
    text = { color: colors.text },
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 12,
      padding: 14,
      gap: 12,
      backgroundColor: colors.card,
    },
    input = {
      color: colors.text,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 8,
      padding: 10,
    };
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
    <View style={card}>
      <Text style={text}>
        {say(
          "Receive compliance evidence",
          "Recibir evidencia de cumplimiento",
        )}
      </Text>
      <Text style={text}>
        {say(
          "This records a private, unverified source. It does not certify eligibility, coverage or a filing. Unknown details can be reviewed later.",
          "Esto registra una fuente privada sin verificar. No certifica elegibilidad, cobertura ni presentación. Los datos desconocidos pueden revisarse después.",
        )}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      {done && (
        <Text style={text}>
          {say(
            "Evidence received — awaiting review.",
            "Evidencia recibida — pendiente de revisión.",
          )}
        </Text>
      )}
      {!fatal && !done && (
        <>
          <FleetChoiceField
            label={say("Resource category", "Categoría de recurso")}
            disabled={disabled}
            value={kind}
            options={Object.entries(subjects).map(([id, label]) => ({
              id,
              label,
            }))}
            onChange={(value) => {
              reset();
              setKind(value as typeof kind);
            }}
          />
          <Text style={text}>
            {say("Search people or assets", "Buscar personas o activos")}
          </Text>
          <TextInput
            accessibilityLabel={say(
              "Search people or assets",
              "Buscar personas o activos",
            )}
            style={input}
            editable={!disabled}
            value={search}
            onChangeText={(value) => {
              reset();
              setSearch(value);
            }}
          />
          <FleetChoiceField
            label={say("For", "Para")}
            value={selection}
            disabled={disabled || loading}
            options={choices.map((row) => ({
              id: fleetComplianceSubjectKey(row.subject),
              label: row.label,
            }))}
            onChange={(value) => {
              setSelection(value);
              setFields({});
              setDocument(null);
              setAffirmed(false);
            }}
          />
          {!!after && (
            <TogglePillButton
              disabled={disabled || loading}
              onPress={() => void load(true)}
            >
              {say(
                "Load more people or assets",
                "Cargar más personas o activos",
              )}
            </TogglePillButton>
          )}
          {selected && !selected.canSubmit && (
            <Text style={text}>
              {say(
                "Your current access allows viewing this resource; source submission is unavailable.",
                "Su acceso permite ver este recurso; no está disponible enviar fuentes.",
              )}
            </Text>
          )}
          {selected?.canSubmit && (
            <>
              <FleetChoiceField
                label={say("Source type", "Tipo de fuente")}
                value={type}
                disabled={disabled}
                options={sourceTypes.map((value) => ({
                  id: value,
                  label: FLEET_COMPLIANCE_SOURCE_KINDS[value][lang],
                }))}
                onChange={(value) => {
                  setType(value as SourceKind);
                  setRule("");
                  setFields({});
                  setAffirmed(false);
                }}
              />
              {!!type && (
                <>
                  {type === "insurance" && (
                    <FleetChoiceField
                      label={say("Coverage category", "Categoría de cobertura")}
                      value={coverageType}
                      disabled={disabled}
                      onChange={setCoverageType}
                      options={FleetCoverageTypeSchema.options.map((value) => ({
                        id: value,
                        label: fleetComplianceSourceChoiceLabel(value, lang),
                      }))}
                    />
                  )}
                  <FleetChoiceField
                    label={say("Adopted requirement", "Requisito adoptado")}
                    value={rule}
                    disabled={disabled}
                    onChange={setRule}
                    options={[
                      {
                        id: "",
                        label: say(
                          "Unmapped source — keep for review",
                          "Fuente sin asignar — conservar para revisión",
                        ),
                      },
                      ...Array.from(latest.values()).map((row) => ({
                        id: row.id,
                        label: `${row.label} · ${row.version}`,
                      })),
                    ]}
                  />
                  <Text style={text}>
                    {say(
                      "Source reference or description",
                      "Referencia o descripción de fuente",
                    )}
                  </Text>
                  <TextInput
                    accessibilityLabel={say(
                      "Source reference or description",
                      "Referencia o descripción de fuente",
                    )}
                    style={input}
                    editable={!disabled}
                    value={source}
                    maxLength={500}
                    onChangeText={setSource}
                  />
                  <TogglePillButton
                    disabled={disabled}
                    onPress={() => void chooseDocument()}
                  >
                    {say("Choose source document", "Elegir documento fuente")}
                  </TogglePillButton>
                  {document && (
                    <Text style={text}>
                      {say(
                        "Source document ready",
                        "Documento fuente preparado",
                      )}{" "}
                      · {document.size.toLocaleString()}{" "}
                      {say("bytes; not yet uploaded", "bytes; aún no cargado")}
                    </Text>
                  )}
                  <Text style={text}>
                    {say(
                      "Optional source details. Enter only what the source actually states; leave unread fields blank.",
                      "Datos opcionales de la fuente. Ingrese solo lo que indica; deje vacíos los datos ilegibles.",
                    )}
                  </Text>
                  {fleetComplianceSourceFields(type).map((field) =>
                    field.options ? (
                      <FleetChoiceField
                        key={field.key}
                        label={field.label[lang]}
                        value={fields[field.key] ?? defaults[field.key] ?? ""}
                        disabled={disabled}
                        onChange={(value) =>
                          setFields({ ...fields, [field.key]: value })
                        }
                        options={field.options.map((value) => ({
                          id: value,
                          label: fleetComplianceSourceChoiceLabel(value, lang),
                        }))}
                      />
                    ) : (
                      <View key={field.key} style={{ gap: 6 }}>
                        <Text style={text}>{field.label[lang]}</Text>
                        <TextInput
                          accessibilityLabel={field.label[lang]}
                          style={input}
                          editable={!disabled}
                          multiline={field.multiline}
                          autoCapitalize="none"
                          value={fields[field.key] ?? ""}
                          maxLength={500}
                          onChangeText={(value) =>
                            setFields({ ...fields, [field.key]: value })
                          }
                        />
                      </View>
                    ),
                  )}
                  <FleetCheckbox
                    disabled={disabled}
                    checked={affirmed}
                    onChange={setAffirmed}
                    label={say(
                      "Save this as received, unverified evidence",
                      "Guardar como evidencia recibida sin verificar",
                    )}
                  />
                  {!prepared ? (
                    <TogglePillButton
                      disabled={!affirmed || disabled}
                      onPress={prepare}
                    >
                      {say("Prepare source", "Preparar fuente")}
                    </TogglePillButton>
                  ) : (
                    <>
                      <Text style={text}>
                        {selected.label} ·{" "}
                        {FLEET_COMPLIANCE_SOURCE_KINDS[type][lang]} ·{" "}
                        {say(
                          "Document received only",
                          "Solo documento recibido",
                        )}
                      </Text>
                      <TogglePillButton
                        disabled={busy}
                        onPress={() => void save()}
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
                      </TogglePillButton>
                      {!uncertain && (
                        <TogglePillButton
                          disabled={busy}
                          onPress={() => {
                            attempt.current = null;
                            setPrepared(false);
                          }}
                        >
                          {say("Edit source", "Editar fuente")}
                        </TogglePillButton>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <TogglePillButton disabled={busy || reading} onPress={onClose}>
        {say("Close source", "Cerrar fuente")}
      </TogglePillButton>
    </View>
  );
}
