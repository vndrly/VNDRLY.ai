import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  AssetIdentifierClaim,
  AssetIdentifierNotice,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { implementationARequest } from "./client";
const en = {
  detail: "Inventory recovery and identifier review",
  reason: "Reason",
  missing: "Report missing",
  stolen: "Report stolen",
  claim: "Request identifier review",
  alias: "Identifier",
  kind: "Identifier type",
  jurisdiction: "Jurisdiction (plates only)",
  review: "Review exact request",
  confirm: "Confirm reviewed request",
  retry: "Retry exact request",
  unknown:
    "Outcome is unverified. Retry the same request without changing its target or version.",
  conflict:
    "Permission or saved version changed. Refresh before preparing another request.",
  refresh: "Refresh current records",
  saved: "Canonical record saved.",
  lossHint:
    "This records a user report and places a hold. Recorded custody remains unchanged; physical loss is not verified.",
  claimHint:
    "An identifier collision requires platform mediation. Ownership is not transferred and the other owner is not disclosed.",
  last: "Last recorded custody",
  tag: "Live tag tracking is not connected. No tag location is available.",
  recorded: "Recorded custody does not verify current physical possession.",
  unavailable: "Current records are unavailable for this account.",
  incoming: "Incoming identifier notices (requester undisclosed)",
  own: "Your asset's identifier claims",
  queue: "Platform identifier review queue",
  decision: "Review decision",
  evidence: "Request evidence",
  reject: "Reject",
  retain: "Retain existing registration",
  correct: "Correct requester identifier",
  corrected: "Corrected identifier",
  none: "No recorded claims.",
  partial: "Only the first 100 records are shown.",
  loading: "Loading current records…",
};
const es: Record<keyof typeof en, string> = {
  detail: "Recuperación y revisión de identificadores",
  reason: "Motivo",
  missing: "Reportar desaparecido",
  stolen: "Reportar robado",
  claim: "Solicitar revisión del identificador",
  alias: "Identificador",
  kind: "Tipo de identificador",
  jurisdiction: "Jurisdicción (solo placas)",
  review: "Revisar solicitud exacta",
  confirm: "Confirmar solicitud revisada",
  retry: "Reintentar solicitud exacta",
  unknown:
    "El resultado no está verificado. Reintente la misma solicitud sin cambiar destino ni versión.",
  conflict:
    "Cambió el permiso o la versión guardada. Actualice antes de preparar otra solicitud.",
  refresh: "Actualizar registros actuales",
  saved: "Registro canónico guardado.",
  lossHint:
    "Se registra un reporte y una retención. La custodia registrada permanece igual; no se verifica la pérdida física.",
  claimHint:
    "Una colisión requiere mediación de la plataforma. No transfiere propiedad ni revela al otro propietario.",
  last: "Última custodia registrada",
  tag: "El seguimiento de etiquetas no está conectado. No hay ubicación disponible.",
  recorded: "La custodia registrada no verifica la posesión física actual.",
  unavailable: "Los registros actuales no están disponibles para esta cuenta.",
  incoming: "Avisos entrantes (solicitante no revelado)",
  own: "Reclamaciones del identificador de su activo",
  queue: "Cola de revisión de la plataforma",
  decision: "Decisión de revisión",
  evidence: "Solicitar evidencia",
  reject: "Rechazar",
  retain: "Conservar registro existente",
  correct: "Corregir identificador del solicitante",
  corrected: "Identificador corregido",
  none: "No hay reclamaciones registradas.",
  partial: "Solo se muestran los primeros 100 registros.",
  loading: "Cargando registros actuales…",
};
const identifierLabels: Record<string, [string, string]> = {
  serial: ["Serial number", "Número de serie"],
  vin: ["Vehicle identification number", "Identificación del vehículo"],
  plate: ["License plate", "Matrícula"],
  asset_tag: ["Asset tag identifier", "Identificador de etiqueta"],
  model: ["Model identifier", "Identificador de modelo"],
  other: ["Other identifier", "Otro identificador"],
};
const statusLabels: Record<string, [string, string]> = {
  pending_review: ["Pending platform review", "Pendiente de revisión"],
  awaiting_evidence: ["Awaiting evidence", "En espera de evidencia"],
  rejected: ["Rejected", "Rechazado"],
  resolved_existing_retained: [
    "Existing registration retained",
    "Registro existente conservado",
  ],
  resolved_requester_corrected: [
    "Requester identifier corrected",
    "Identificador del solicitante corregido",
  ],
};
function translatedLabel(
  value: string,
  c: typeof en,
  labels: Record<string, [string, string]>,
) {
  return labels[value]?.[c === es ? 1 : 0] ?? value;
}
function sameIdentifier(a: unknown, b: unknown) {
  const x = a as
      | { kind?: unknown; value?: unknown; jurisdiction?: unknown }
      | undefined,
    y = b as typeof x;
  return (
    !!x &&
    !!y &&
    x.kind === y.kind &&
    x.value === y.value &&
    x.jurisdiction === y.jurisdiction
  );
}
function useCopy() {
  const { i18n } = useTranslation();
  return i18n.language.startsWith("es") ? es : en;
}
type Attempt = {
  path: string;
  body: Record<string, unknown>;
  assetId: string;
  version: number;
  kind: "loss" | "claim" | "resolve";
  claimId?: string;
};
/** Retains the reviewed target and body after an unknown result; account/asset identity fences every response. */
export function InventoryRecoveryWrite({
  identity,
  assetId,
  version,
  kind,
  claimId,
  onSaved,
}: {
  identity: string;
  assetId: string;
  version: number;
  kind: Attempt["kind"];
  claimId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const c = useCopy(),
    [reason, setReason] = useState(""),
    [condition, setCondition] = useState("missing"),
    [alias, setAlias] = useState(""),
    [aliasKind, setAliasKind] = useState("serial"),
    [jurisdiction, setJurisdiction] = useState(""),
    [decision, setDecision] = useState("request_evidence"),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState("");
  const scope = identity + ":" + assetId + ":" + kind + ":" + (claimId ?? ""),
    current = useRef(scope),
    alive = useRef(true);
  current.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setAttempt(null);
    setReason("");
    setAlias("");
    setMessage("");
    setUnknown(false);
    setConflict(false);
    setBusy(false);
  }, [scope]);
  function prepare() {
    const operationId = crypto.randomUUID(),
      identifier = {
        kind: aliasKind,
        value: alias.trim(),
        ...(jurisdiction.trim() ? { jurisdiction: jurisdiction.trim() } : {}),
      };
    const body: Record<string, unknown> = {
      operationId,
      expectedVersion: version,
      reason: reason.trim(),
      confirmed: true,
    };
    let path = "/assets/" + assetId;
    if (kind === "loss") {
      path += "/loss-report";
      body.condition = condition;
    } else if (kind === "claim") {
      path += "/identifier-claims";
      body.claimId = crypto.randomUUID();
      body.alias = identifier;
    } else {
      path += "/identifier-claims/" + claimId + "/resolve";
      body.decision = decision;
      if (decision === "correct_requester_alias")
        body.correctedAlias = identifier;
    }
    setAttempt({
      path,
      body,
      assetId,
      version,
      kind,
      claimId: kind === "claim" ? String(body.claimId) : claimId,
    });
    setMessage("");
  }
  async function save() {
    if (!attempt) return;
    const sent = attempt,
      at = scope,
      isCurrent = () => alive.current && current.current === at;
    setBusy(true);
    try {
      const r = await implementationARequest<Record<string, unknown>>(
        sent.path,
        { method: "POST", body: JSON.stringify(sent.body) },
      );
      if (!isCurrent()) return;
      const exact =
        r.assetId === sent.assetId &&
        r.operationId === sent.body.operationId &&
        r.version === sent.version + 1;
      if (sent.kind === "loss") {
        if (
          !exact ||
          r.status !== "applied" ||
          r.condition !== sent.body.condition ||
          r.physicalLossVerified !== false
        )
          throw Error("Unexpected receipt");
      } else {
        const status =
          sent.kind === "claim"
            ? "pending_review"
            : (
                {
                  request_evidence: "awaiting_evidence",
                  reject: "rejected",
                  retain_existing: "resolved_existing_retained",
                  correct_requester_alias: "resolved_requester_corrected",
                } as Record<string, string>
              )[String(sent.body.decision)];
        if (
          r.assetId !== sent.assetId ||
          r.operationId !== sent.body.operationId ||
          r.id !== sent.claimId ||
          r.version !== (sent.kind === "claim" ? 1 : sent.version + 1) ||
          r.status !== status ||
          r.ownershipTransferred !== false ||
          r.otherOwnerDisclosed !== false ||
          (sent.kind === "claim" &&
            !sameIdentifier(r.alias, sent.body.alias)) ||
          (sent.body.correctedAlias !== undefined &&
            !sameIdentifier(r.correctedAlias, sent.body.correctedAlias))
        )
          throw Error("Unexpected receipt");
      }
      setAttempt(null);
      setUnknown(false);
      setMessage(c.saved);
      await onSaved().catch(() => undefined);
    } catch (e) {
      if (!isCurrent()) return;
      const code = e instanceof Error ? e.message : "";
      const changed =
        /asset\.(version_conflict|current_session_required|current_membership_required|asset_manager_required|not_found|mediator_required|claim_terminal|loss_report_unavailable|claim_unavailable|identifier_in_use|identifier_collision_required|invalid_identifier|operation_reused)/.test(
          code,
        );
      setConflict(changed);
      setUnknown(!changed);
      setMessage(changed ? c.conflict : c.unknown);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const needsAlias =
    kind === "claim" ||
    (kind === "resolve" && decision === "correct_requester_alias");
  return (
    <section className="grid gap-2 rounded border p-3">
      <p>{kind === "loss" ? c.lossHint : c.claimHint}</p>
      {!attempt ? (
        <>
          <label>
            {c.reason}
            <textarea
              aria-label={c.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          </label>
          {kind === "loss" && (
            <select
              aria-label={c.kind}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="missing">{c.missing}</option>
              <option value="stolen">{c.stolen}</option>
            </select>
          )}
          {kind === "resolve" && (
            <label>
              {c.decision}
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
              >
                <option value="request_evidence">{c.evidence}</option>
                <option value="reject">{c.reject}</option>
                <option value="retain_existing">{c.retain}</option>
                <option value="correct_requester_alias">{c.correct}</option>
              </select>
            </label>
          )}
          {needsAlias && (
            <>
              <label>
                {c.kind}
                <select
                  value={aliasKind}
                  onChange={(e) => setAliasKind(e.target.value)}
                >
                  {[
                    "serial",
                    "vin",
                    "plate",
                    "asset_tag",
                    "model",
                    "other",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {translatedLabel(k, c, identifierLabels)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {kind === "resolve" ? c.corrected : c.alias}
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  maxLength={200}
                />
              </label>
              {aliasKind === "plate" && (
                <label>
                  {c.jurisdiction}
                  <input
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    maxLength={32}
                  />
                </label>
              )}
            </>
          )}
          <PngPillButton
            disabled={
              busy ||
              !reason.trim() ||
              (needsAlias && !alias.trim()) ||
              (aliasKind === "plate" &&
                needsAlias &&
                jurisdiction.trim().length < 2)
            }
            onClick={prepare}
          >
            {c.review}
          </PngPillButton>
        </>
      ) : (
        <>
          <p>
            v{attempt.version} · {String(attempt.body.reason)}
          </p>
          <p>
            {kind === "loss"
              ? String(attempt.body.condition)
              : String(attempt.body.decision ?? alias)}
          </p>
          {conflict ? (
            <PngPillButton
              disabled={busy}
              onClick={async () => {
                const at = scope;
                await onSaved();
                if (alive.current && current.current === at) {
                  setAttempt(null);
                  setConflict(false);
                  setMessage("");
                }
              }}
            >
              {c.refresh}
            </PngPillButton>
          ) : (
            <PngPillButton disabled={busy} onClick={() => void save()}>
              {unknown ? c.retry : c.confirm}
            </PngPillButton>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
type Detail = {
  id: string;
  version: number;
  holderUserId: number | null;
  lastCustody?: {
    holderDisplayName: string | null;
    holderUserId: number | null;
    recordedAt: string;
  } | null;
  gpsTag?: { status: string; location: null };
};
type Claims = {
  claims: AssetIdentifierClaim[];
  truncated: boolean;
  incoming?: AssetIdentifierNotice[];
  incomingTruncated?: boolean;
};
export function InventoryRecovery({
  assetId,
  identity,
  userId,
  canManage,
  onSaved,
}: {
  assetId: string;
  identity: string;
  userId: number;
  canManage: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const c = useCopy(),
    [open, setOpen] = useState(false);
  const detail = useQuery<Detail>({
    queryKey: ["asset-recovery", identity, assetId],
    queryFn: () => implementationARequest("/assets/" + assetId),
    enabled: open,
  });
  const claims = useQuery<Claims>({
    queryKey: ["asset-claims", identity, assetId],
    queryFn: () =>
      implementationARequest("/assets/" + assetId + "/identifier-claims"),
    enabled: open && canManage,
  });
  const refresh = async () => {
    await Promise.all([
      detail.refetch(),
      canManage ? claims.refetch() : Promise.resolve(),
      onSaved(),
    ]);
  };
  return (
    <section>
      <PngPillButton onClick={() => setOpen((v) => !v)}>
        {c.detail}
      </PngPillButton>
      {open && (
        <div className="grid gap-3 p-2">
          {detail.isError ? (
            <p>{c.unavailable}</p>
          ) : !detail.data ? (
            <p>{c.loading}</p>
          ) : (
            <>
              <p>{c.tag}</p>
              {detail.data.lastCustody && (
                <p>
                  {c.last}:{" "}
                  {detail.data.lastCustody.holderDisplayName ??
                    detail.data.lastCustody.holderUserId}{" "}
                  · {detail.data.lastCustody.recordedAt}
                </p>
              )}
              <p>{c.recorded}</p>
              {(canManage || detail.data.holderUserId === userId) && (
                <InventoryRecoveryWrite
                  key={identity + assetId + "loss"}
                  identity={identity}
                  assetId={assetId}
                  version={detail.data.version}
                  kind="loss"
                  onSaved={refresh}
                />
              )}
              {canManage && (
                <InventoryRecoveryWrite
                  key={identity + assetId + "claim"}
                  identity={identity}
                  assetId={assetId}
                  version={detail.data.version}
                  kind="claim"
                  onSaved={refresh}
                />
              )}
            </>
          )}
          {canManage &&
            (claims.isError ? (
              <p>{c.unavailable}</p>
            ) : (
              claims.data && (
                <>
                  <h4>{c.own}</h4>
                  {claims.data.claims.length ? (
                    claims.data.claims.map((x) => (
                      <p key={x.id}>
                        {x.alias.value} ·{" "}
                        {translatedLabel(x.status, c, statusLabels)} ·{" "}
                        {x.reviewReason} {x.correctedAlias?.value}
                      </p>
                    ))
                  ) : (
                    <p>{c.none}</p>
                  )}
                  <h4>{c.incoming}</h4>
                  {claims.data.incoming?.map((x) => (
                    <p key={x.id}>
                      {x.alias.value} · {x.status} · {x.submittedAt}
                    </p>
                  ))}
                  {(claims.data.truncated || claims.data.incomingTruncated) && (
                    <p>{c.partial}</p>
                  )}
                </>
              )
            ))}
        </div>
      )}
    </section>
  );
}
export function InventoryIdentifierQueue({ identity }: { identity: string }) {
  const c = useCopy();
  const q = useQuery<Claims>({
    queryKey: ["asset-mediator-queue", identity],
    queryFn: () => implementationARequest("/asset-identifier-claims"),
  });
  return (
    <section className="grid gap-3">
      <h3>{c.queue}</h3>
      {q.isError ? (
        <p>{c.unavailable}</p>
      ) : q.data ? (
        <>
          {q.data.claims.map((x) => (
            <div key={x.id}>
              <p>
                {x.alias.value} · {x.reason} · {x.status}
              </p>
              <InventoryRecoveryWrite
                key={identity + x.id}
                identity={identity}
                assetId={x.assetId}
                version={x.version}
                claimId={x.id}
                kind="resolve"
                onSaved={() => q.refetch()}
              />
            </div>
          ))}
          {!q.data.claims.length && <p>{c.none}</p>}
          {q.data.truncated && <p>{c.partial}</p>}
        </>
      ) : (
        <p>{c.loading}</p>
      )}
    </section>
  );
}
