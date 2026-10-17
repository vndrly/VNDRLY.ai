import {FleetCoverageRequirementFields} from "./fleet-coverage-requirement-fields";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FLEET_REQUIREMENT_TEMPLATES,
  draftFleetRequirement,
  verifyFleetRequirementAdoption,
  FleetComplianceRequirementAdoptSchema,
  FleetComplianceRequirementsViewSchema,
  type FleetRequirementVersion,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient, FleetRequestError } from "@/lib/fleet-client";
import { BrandedCheckbox } from "./branded-checkbox";
import { PngPillButton } from "./png-pill-rollover";
type Attempt = z.infer<typeof FleetComplianceRequirementAdoptSchema>;
export function FleetComplianceRules(props: {
  identity: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  return <Rules key={props.identity} {...props} />;
}
function Rules({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const { i18n } = useTranslation(),
    lang = i18n.language.startsWith("es") ? "es" : "en";
  const say = (en: string, es: string) => (lang === "es" ? es : en);
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
  const attempt = useRef<Attempt | null>(null),
    alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    void fleetClient
      .complianceRequirements()
      .then((value) => {
        if (alive.current) setData(value);
      })
      .catch(() => {
        if (alive.current)
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
    if (!draft || !reviewed || !data?.canAdopt) return;
    try {
      attempt.current = FleetComplianceRequirementAdoptSchema.parse({
        operationId: crypto.randomUUID(),
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
    if (lock.current || !attempt.current || !data?.canAdopt) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await fleetClient.adoptComplianceRequirement(
        attempt.current,
      );
      const canonical = await fleetClient.complianceRequirements();
      verifyFleetRequirementAdoption(
        attempt.current.requirement,
        saved,
        canonical,
      );
      if (!alive.current) return;
      setData(canonical);
      setDraft(null);
      setChoice("");
      setReviewed(false);
      setPrepared(false);
      setUncertain(false);
      attempt.current = null;
      onSaved();
    } catch (reason) {
      if (!alive.current) return;
      if (
        reason instanceof FleetRequestError &&
        reason.status >= 400 &&
        reason.status < 500
      ) {
        setDraft(null);
        setData(null);
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
      if (alive.current) setBusy(false);
    }
  }
  const reference = FLEET_REQUIREMENT_TEMPLATES.find(
    (row) => row.id === draft?.id,
  );
  const disabled = prepared || busy;
  return (
    <section
      className="fleet-detail-group space-y-3"
      aria-label={say("Requirements and history", "Requisitos e historial")}
    >
      <h3>{say("Requirements and history", "Requisitos e historial")}</h3>
      <p>
        {say(
          "References require your source and scope review. Adoption never activates enforcement or verifies a document. Previous revisions remain in history.",
          "Las referencias requieren revisión de fuente y alcance. Adoptar no activa bloqueo ni verifica documentos. Las revisiones anteriores permanecen en el historial.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {data && !data.requirements.length && (
        <p>
          {say(
            "No adopted requirements. Missing configuration does not establish compliance.",
            "No hay requisitos adoptados. La falta de configuración no acredita cumplimiento.",
          )}
        </p>
      )}
      {data?.canAdopt && (
        <label>
          {say("Requirement reference", "Referencia del requisito")}
          <select
            value={choice}
            disabled={disabled}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">
              {say(
                "Choose a reference or revise a saved requirement",
                "Elija referencia o revise un requisito guardado",
              )}
            </option>
            <optgroup
              label={say(
                "Research references — review before adoption",
                "Referencias — revise antes de adoptar",
              )}
            >
              {FLEET_REQUIREMENT_TEMPLATES.map((row) => (
                <option key={row.id} value={`reference:${row.id}`}>
                  {row.label[lang]} · {row.jurisdiction}
                </option>
              ))}
            </optgroup>
            <optgroup label={say("Saved requirements", "Requisitos guardados")}>
              {Array.from(latest.values()).map((row) => (
                <option key={row.id} value={`saved:${row.id}`}>
                  {row.label} · {row.version}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}
      {draft && data?.canAdopt && (
        <div className="space-y-3">
          {reference && (
            <p>
              {reference.guidance[lang]}{" "}
              {say("Research checked", "Investigación comprobada")}:{" "}
              {reference.researchedAt}
            </p>
          )}
          <a href={draft.source.url} target="_blank" rel="noopener noreferrer">
            {say(
              "Official source — review current text",
              "Fuente oficial — revise texto vigente",
            )}
          </a>
          <label>
            {say("Requirement label", "Nombre del requisito")}
            <input
              disabled={disabled}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label>
            {say("Source URL", "URL de fuente")}
            <input
              disabled={disabled}
              value={draft.source.url}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  source: { ...draft.source, url: e.target.value },
                })
              }
            />
          </label>
          <label>
            {say("Source section and scope", "Sección y alcance de fuente")}
            <input
              disabled={disabled}
              value={draft.source.section}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  source: { ...draft.source, section: e.target.value },
                })
              }
            />
          </label>
          <label>
            {say("Due-soon notice (days)", "Aviso previo (días)")}
            <input
              type="number"
              min={0}
              max={365}
              disabled={disabled}
              value={draft.dueSoonDays}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dueSoonDays:
                    e.target.value === "" ? Number.NaN : Number(e.target.value),
                })
              }
            />
          </label>
          {draft.category==="insurance"&&<FleetCoverageRequirementFields key={`${choice}:${draft.id}:${draft.version}`} value={draft.coverage} disabled={disabled} onChange={coverage=>setDraft({...draft,coverage})}/>}
          <label className="flex items-center gap-2">
            <BrandedCheckbox
              disabled={disabled}
              checked={draft.expiryRequired === true}
              onCheckedChange={(value) =>
                setDraft({ ...draft, expiryRequired: value === true })
              }
            />
            {say(
              "Require the source's actual expiry",
              "Exigir vencimiento real de la fuente",
            )}
          </label>
          <p>
            {say("Applies from", "Vigente desde")}:{" "}
            {new Date(draft.effectiveFrom).toLocaleString()} ·{" "}
            {say("Revision", "Revisión")} {draft.version}
          </p>
          <p>
            {say(
              "Applicability must be reviewed separately for the carrier, driver or equipment and actual work. Unknown remains unverified.",
              "Revise aplicabilidad por separado para transportista, conductor o equipo y trabajo real. Desconocido permanece sin verificar.",
            )}
          </p>
          <label className="flex items-center gap-2">
            <BrandedCheckbox
              disabled={disabled}
              checked={reviewed}
              onCheckedChange={(value) => setReviewed(value === true)}
            />
            {say(
              "I reviewed the source, scope and exceptions",
              "Revisé fuente, alcance y excepciones",
            )}
          </label>
          {!prepared ? (
            <PngPillButton disabled={!reviewed || busy} onClick={prepare}>
              {say(
                "Prepare requirement revision",
                "Preparar revisión del requisito",
              )}
            </PngPillButton>
          ) : (
            <>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {uncertain
                  ? say(
                      "Retry the same requirement revision",
                      "Reintentar la misma revisión",
                    )
                  : say(
                      "Adopt requirement revision",
                      "Adoptar revisión del requisito",
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
                  {say("Edit requirement", "Editar requisito")}
                </PngPillButton>
              )}
            </>
          )}
        </div>
      )}
      {data?.requirements
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id) || b.version - a.version)
        .map((row) => (
          <article
            key={`${row.id}:${row.version}`}
            className="fleet-detail-group"
          >
            <h4>
              {row.label} · {say("Revision", "Revisión")} {row.version}
            </h4>
            <p>
              {row.jurisdiction} ·{" "}
              {new Date(row.effectiveFrom).toLocaleString()}
              {row.effectiveUntil
                ? ` – ${new Date(row.effectiveUntil).toLocaleString()}`
                : ""}
            </p>
            <a href={row.source.url} target="_blank" rel="noopener noreferrer">
              {row.source.section}
            </a>
            <p>
              {say("Reviewed", "Revisado")}:{" "}
              {new Date(row.source.reviewedAt).toLocaleString()} · #
              {row.source.reviewedByUserId}
            </p>
          </article>
        ))}
      <PngPillButton disabled={busy} onClick={onClose}>
        {say("Close requirements", "Cerrar requisitos")}
      </PngPillButton>
    </section>
  );
}
