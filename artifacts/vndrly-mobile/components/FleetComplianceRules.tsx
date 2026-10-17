import FleetCoverageRequirementFields from "./FleetCoverageRequirementFields";
import React, { useEffect, useRef, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  FLEET_REQUIREMENT_TEMPLATES,
  draftFleetRequirement,
  verifyFleetRequirementAdoption,
  FleetComplianceRequirementAdoptSchema,
  FleetComplianceRequirementsViewSchema,
  type FleetRequirementVersion,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import FleetCheckbox from "./FleetCheckbox";
import FleetChoiceField from "./FleetChoiceField";
import TogglePillButton from "./TogglePillButton";
type Attempt = z.infer<typeof FleetComplianceRequirementAdoptSchema>;
type Props = { onSaved: () => void; onClose: () => void };
export default function FleetComplianceRules(props: Props) {
  return <Rules key={captureAuthScope().generation} {...props} />;
}
function Rules({ onSaved, onClose }: Props) {
  const colors = useColors(),
    { i18n } = useTranslation(),
    lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es")
      ? "es"
      : "en";
  const say = (en: string, es: string) => (lang === "es" ? es : en);
  const scope = useRef(captureAuthScope()),
    alive = useRef(true),
    lock = useRef(false),
    attempt = useRef<Attempt | null>(null);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const [data, setData] = useState<z.infer<
    typeof FleetComplianceRequirementsViewSchema
  > | null>(null);
  const [choice, setChoice] = useState(""),
    [draft, setDraft] = useState<Attempt["requirement"] | null>(null);
  const [reviewed, setReviewed] = useState(false),
    [prepared, setPrepared] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  const read = async () =>
    FleetComplianceRequirementsViewSchema.parse(
      await apiFetch<unknown>(
        "/api/fleet/compliance/requirements",
        {},
        scope.current,
      ),
    );
  useEffect(() => {
    alive.current = true;
    void read()
      .then((value) => {
        if (current()) setData(value);
      })
      .catch(() => {
        if (current())
          setError(
            say(
              "Requirements unavailable. Close and reload to check access.",
              "Requisitos no disponibles. Cierre y vuelva a cargar para comprobar acceso.",
            ),
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = new Map<string, FleetRequirementVersion>();
  for (const row of data?.requirements ?? [])
    if (!latest.has(row.id) || latest.get(row.id)!.version < row.version)
      latest.set(row.id, row);
  function select(value: string) {
    setChoice(value);
    setReviewed(false);
    setPrepared(false);
    setError("");
    attempt.current = null;
    const separator = value.indexOf(":"),
      kind = value.slice(0, separator),
      id = value.slice(separator + 1),
      previous = latest.get(id);
    if (kind === "reference")
      setDraft(
        draftFleetRequirement(id, {
          version: (previous?.version ?? 0) + 1,
          effectiveFrom: new Date().toISOString(),
        }),
      );
    else if (previous) {
      const {
        reviewedAt: _at,
        reviewedByUserId: _by,
        ...source
      } = previous.source;
      setDraft({
        ...previous,
        version: previous.version + 1,
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: null,
        source,
      });
    } else setDraft(null);
  }
  function prepare() {
    if (!current() || !draft || !reviewed || !data?.canAdopt) return;
    try {
      attempt.current = FleetComplianceRequirementAdoptSchema.parse({
        operationId: Crypto.randomUUID(),
        expectedVersion: draft.version - 1,
        requirement: draft,
      });
      setDraft(attempt.current.requirement);
      setPrepared(true);
      setError("");
    } catch {
      setError(
        say(
          "Check the label, source and reminder values.",
          "Revise nombre, fuente y valores de aviso.",
        ),
      );
    }
  }
  async function save() {
    if (lock.current || !current() || !attempt.current || !data?.canAdopt)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await apiFetch<unknown>(
        "/api/fleet/compliance/requirements",
        { method: "POST", body: JSON.stringify(attempt.current) },
        scope.current,
      );
      const canonical = await read();
      verifyFleetRequirementAdoption(
        attempt.current.requirement,
        saved,
        canonical,
      );
      if (!current()) return;
      setData(canonical);
      setDraft(null);
      setChoice("");
      setReviewed(false);
      setPrepared(false);
      setUncertain(false);
      attempt.current = null;
      onSaved();
    } catch (reason) {
      if (!current()) return;
      const status = (reason as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        setData(null);
        setDraft(null);
        setPrepared(false);
        attempt.current = null;
        setError(
          say(
            "Access or revision changed. Close and reload before making another change.",
            "Cambió el acceso o la revisión. Cierre y vuelva a cargar antes de cambiar.",
          ),
        );
      } else {
        setUncertain(true);
        setError(
          say(
            "Requirement save needs verification. Retry the same prepared revision.",
            "Debe verificarse el guardado. Reintente la misma revisión preparada.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  if (!current()) return null;
  const reference = FLEET_REQUIREMENT_TEMPLATES.find(
      (row) => row.id === draft?.id,
    ),
    disabled = prepared || busy;
  const text = { color: colors.text },
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 12,
      padding: 14,
      gap: 12,
      backgroundColor: colors.card,
    };
  const input = {
    color: colors.text,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    padding: 10,
  };
  return (
    <View style={card}>
      <Text style={text}>
        {say("Requirements and history", "Requisitos e historial")}
      </Text>
      <Text style={text}>
        {say(
          "References require your source and scope review. Adoption never activates enforcement or verifies a document. Previous revisions remain in history.",
          "Las referencias requieren revisión de fuente y alcance. Adoptar no activa bloqueo ni verifica documentos. Las revisiones anteriores permanecen en el historial.",
        )}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      {data && !data.requirements.length && (
        <Text style={text}>
          {say(
            "No adopted requirements. Missing configuration does not establish compliance.",
            "No hay requisitos adoptados. La falta de configuración no acredita cumplimiento.",
          )}
        </Text>
      )}
      {data?.canAdopt && (
        <FleetChoiceField
          label={say("Requirement reference", "Referencia del requisito")}
          value={choice}
          disabled={disabled}
          onChange={select}
          options={[
            ...FLEET_REQUIREMENT_TEMPLATES.map((row) => ({
              id: `reference:${row.id}`,
              label: `${row.label[lang]} · ${row.jurisdiction}`,
            })),
            ...Array.from(latest.values()).map((row) => ({
              id: `saved:${row.id}`,
              label: `${say("Revise", "Revisar")}: ${row.label} · ${row.version}`,
            })),
          ]}
        />
      )}
      {draft && data?.canAdopt && (
        <View style={{ gap: 12 }}>
          {reference && (
            <Text style={text}>
              {reference.guidance[lang]}{" "}
              {say("Research checked", "Investigación comprobada")}:{" "}
              {reference.researchedAt}
            </Text>
          )}
          <TogglePillButton
            onPress={() => {
              if (/^https:\/\//.test(draft.source.url))
                void Linking.openURL(draft.source.url).catch(() =>
                  setError(
                    say(
                      "Source could not be opened.",
                      "No se pudo abrir la fuente.",
                    ),
                  ),
                );
            }}
          >
            {say(
              "Official source — review current text",
              "Fuente oficial — revise texto vigente",
            )}
          </TogglePillButton>
          <Text style={text}>
            {say("Requirement label", "Nombre del requisito")}
          </Text>
          <TextInput
            accessibilityLabel={say(
              "Requirement label",
              "Nombre del requisito",
            )}
            style={input}
            editable={!disabled}
            value={draft.label}
            onChangeText={(label) => setDraft({ ...draft, label })}
          />
          <Text style={text}>{say("Source URL", "URL de fuente")}</Text>
          <TextInput
            accessibilityLabel={say("Source URL", "URL de fuente")}
            style={input}
            editable={!disabled}
            autoCapitalize="none"
            value={draft.source.url}
            onChangeText={(url) =>
              setDraft({ ...draft, source: { ...draft.source, url } })
            }
          />
          <Text style={text}>
            {say("Source section and scope", "Sección y alcance de fuente")}
          </Text>
          <TextInput
            accessibilityLabel={say(
              "Source section and scope",
              "Sección y alcance de fuente",
            )}
            style={input}
            editable={!disabled}
            value={draft.source.section}
            onChangeText={(section) =>
              setDraft({ ...draft, source: { ...draft.source, section } })
            }
          />
          <Text style={text}>
            {say("Due-soon notice (days)", "Aviso previo (días)")}
          </Text>
          <TextInput
            accessibilityLabel={say(
              "Due-soon notice (days)",
              "Aviso previo (días)",
            )}
            style={input}
            editable={!disabled}
            keyboardType="number-pad"
            value={String(draft.dueSoonDays)}
            onChangeText={(value) =>
              setDraft({
                ...draft,
                dueSoonDays: value === "" ? Number.NaN : Number(value),
              })
            }
          />
          {draft.category==="insurance"&&<FleetCoverageRequirementFields key={`${choice}:${draft.id}:${draft.version}`} value={draft.coverage} disabled={disabled} onChange={coverage=>setDraft({...draft,coverage})}/>}
          <FleetCheckbox
            label={say(
              "Require the source's actual expiry",
              "Exigir vencimiento real de la fuente",
            )}
            disabled={disabled}
            checked={draft.expiryRequired === true}
            onChange={(expiryRequired) =>
              setDraft({ ...draft, expiryRequired })
            }
          />
          <Text style={text}>
            {say("Applies from", "Vigente desde")}:{" "}
            {new Date(draft.effectiveFrom).toLocaleString()} ·{" "}
            {say("Revision", "Revisión")} {draft.version}
          </Text>
          <Text style={text}>
            {say(
              "Applicability must be reviewed separately for the carrier, driver or equipment and actual work. Unknown remains unverified.",
              "Revise aplicabilidad por separado para transportista, conductor o equipo y trabajo real. Desconocido permanece sin verificar.",
            )}
          </Text>
          <FleetCheckbox
            label={say(
              "I reviewed the source, scope and exceptions",
              "Revisé fuente, alcance y excepciones",
            )}
            disabled={disabled}
            checked={reviewed}
            onChange={setReviewed}
          />
          {!prepared ? (
            <TogglePillButton disabled={!reviewed || busy} onPress={prepare}>
              {say(
                "Prepare requirement revision",
                "Preparar revisión del requisito",
              )}
            </TogglePillButton>
          ) : (
            <>
              <TogglePillButton disabled={busy} onPress={() => void save()}>
                {uncertain
                  ? say(
                      "Retry the same requirement revision",
                      "Reintentar la misma revisión",
                    )
                  : say(
                      "Adopt requirement revision",
                      "Adoptar revisión del requisito",
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
                  {say("Edit requirement", "Editar requisito")}
                </TogglePillButton>
              )}
            </>
          )}
        </View>
      )}
      {data?.requirements
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id) || b.version - a.version)
        .map((row) => (
          <View key={`${row.id}:${row.version}`} style={card}>
            <Text style={text}>
              {row.label} · {say("Revision", "Revisión")} {row.version}
            </Text>
            <Text style={text}>
              {row.jurisdiction} ·{" "}
              {new Date(row.effectiveFrom).toLocaleString()}
              {row.effectiveUntil
                ? ` – ${new Date(row.effectiveUntil).toLocaleString()}`
                : ""}
            </Text>
            <Text style={text}>{row.source.section}</Text>
            <Text style={text}>
              {say("Reviewed", "Revisado")}:{" "}
              {new Date(row.source.reviewedAt).toLocaleString()} · #
              {row.source.reviewedByUserId}
            </Text>
          </View>
        ))}
      <TogglePillButton disabled={busy} onPress={onClose}>
        {say("Close requirements", "Cerrar requisitos")}
      </TogglePillButton>
    </View>
  );
}
