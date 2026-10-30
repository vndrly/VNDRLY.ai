import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FleetComplianceConfigurationViewSchema,
  FleetComplianceReviewerSaveSchema,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { BrandedCheckbox } from "./branded-checkbox";
import { PngPillButton } from "./png-pill-rollover";
type Props = { identity: string; onChanged: () => void };
type Config = z.infer<typeof FleetComplianceConfigurationViewSchema>;
type Attempt = z.infer<typeof FleetComplianceReviewerSaveSchema>;
export function FleetComplianceReviewers(props: Props) {
  return <ReviewerForm key={props.identity} {...props} />;
}
function ReviewerForm({ onChanged }: Props) {
  const [refresh, setRefresh] = useState(0);
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    alive = useRef(true),
    request = useRef<Attempt | null>(null),
    lock = useRef(false);
  const [config, setConfig] = useState<Config | null>(null),
    [members, setMembers] = useState<Array<{
      userId: number;
      name: string;
    }> | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [prepared, setPrepared] = useState(false),
    [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    alive.current = true;
    setError("");
    void fleetClient
      .complianceConfiguration()
      .then((value) => {
        if (alive.current) {
          setConfig(value);
          setSelected(value.reviewerUserIds);
        }
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const directory = await fleetClient.setup();
      if (alive.current) setMembers(directory.members);
    } catch {
      if (alive.current)
        setError(
          es
            ? "Miembros no disponibles. Actualice antes de cambiar el acceso."
            : "Company members unavailable. Reload before changing access.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function prepare() {
    if (!config) return;
    try {
      request.current = FleetComplianceReviewerSaveSchema.parse({
        operationId: crypto.randomUUID(),
        expectedVersion: config.version,
        reviewerUserIds: selected,
      });
      setPrepared(true);
      setError("");
    } catch {
      setError(
        es
          ? "Revise los miembros seleccionados."
          : "Review the selected members.",
      );
    }
  }
  async function save() {
    if (!request.current || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await fleetClient.saveComplianceReviewers(
          request.current,
        ),
        current = await fleetClient.complianceConfiguration();
      if (!alive.current) return;
      const same = (a: number[], b: number[]) =>
        JSON.stringify([...a].sort((x, y) => x - y)) ===
        JSON.stringify([...b].sort((x, y) => x - y));
      if (
        !current.mayAppointReviewers ||
        current.version < receipt.version ||
        !same(receipt.reviewerUserIds, request.current.reviewerUserIds) ||
        !same(current.reviewerUserIds, receipt.reviewerUserIds)
      ) {
        request.current = null;
        setMembers(null);
        setPrepared(false);
        setConfig(null);
        setError(
          es
            ? "El acceso cambió nuevamente. Actualice la configuración actual."
            : "Reviewer access changed again. Reload the current configuration.",
        );
        return;
      }
      request.current = null;
      setConfig(current);
      setSelected(current.reviewerUserIds);
      setMembers(null);
      setPrepared(false);
      setUncertain(false);
      onChanged();
    } catch (cause) {
      if (alive.current) {
        const status = (cause as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          request.current = null;
          setMembers(null);
          setPrepared(false);
          setConfig(null);
          setError(
            es
              ? "La configuración o sus permisos cambiaron. Actualice antes de volver a intentarlo."
              : "Configuration or permissions changed. Reload before trying again.",
          );
        } else {
          setUncertain(true);
          setError(
            es
              ? "Debe verificarse el acceso. Reintente el mismo cambio."
              : "Reviewer access needs verification. Retry the same change.",
          );
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!config?.mayAppointReviewers && !error) return null;
  const directory = members
    ? [
        ...new Map(
          [
            ...members,
            ...selected
              .filter((id) => !members.some((member) => member.userId === id))
              .map((userId) => ({
                userId,
                name: `${es ? "Miembro anterior" : "Former member"} #${userId}`,
              })),
          ].map((member) => [member.userId, member]),
        ).values(),
      ]
    : [];
  return (
    <section className="fleet-detail-group space-y-3">
      <CardHeading as="h3">{es ? "Revisores de evidencia" : "Evidence reviewers"}</CardHeading>
      <p>
        {es
          ? "Los revisores designados pueden leer y revisar licencias completas y registros médicos, de pruebas y de cobertura privados. Despacho y finanzas conservan sus permisos separados."
          : "Appointed reviewers can read and review full licenses and private medical, testing and coverage records. Dispatch and finance keep their separate permissions."}
      </p>
      {!!error && <p role="alert">{error}</p>}
      {!config && !!error && (
        <PngPillButton
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {es ? "Recargar acceso de revisores" : "Reload reviewer access"}
        </PngPillButton>
      )}
      {config?.mayAppointReviewers && !members && (
        <PngPillButton disabled={busy} onClick={() => void open()}>
          {es ? "Cambiar revisores" : "Change evidence reviewers"}
        </PngPillButton>
      )}
      {members && (
        <>
          <fieldset disabled={busy || prepared}>
            {directory.map((member) => (
              <label key={member.userId} className="flex items-center gap-2">
                <BrandedCheckbox
                  aria-label={member.name}
                  checked={selected.includes(member.userId)}
                  onCheckedChange={(checked) =>
                    setSelected((prior) =>
                      checked
                        ? [...new Set([...prior, member.userId])]
                        : prior.filter((id) => id !== member.userId),
                    )
                  }
                />
                {member.name}
              </label>
            ))}
          </fieldset>
          {prepared ? (
            <>
              <p>
                {es
                  ? "Revise estos permisos privados antes de guardarlos."
                  : "Review these private-evidence permissions before saving."}
              </p>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {uncertain
                  ? es
                    ? "Reintentar el mismo cambio"
                    : "Retry the same reviewer change"
                  : es
                    ? "Guardar acceso de revisores"
                    : "Save reviewer access"}
              </PngPillButton>
              {!uncertain && (
                <PngPillButton
                  disabled={busy}
                  onClick={() => {
                    request.current = null;
                    setPrepared(false);
                  }}
                >
                  {es ? "Editar selección" : "Edit reviewer selection"}
                </PngPillButton>
              )}
            </>
          ) : (
            <PngPillButton disabled={busy} onClick={prepare}>
              {es ? "Revisar acceso de revisores" : "Review reviewer access"}
            </PngPillButton>
          )}
        </>
      )}
    </section>
  );
}
