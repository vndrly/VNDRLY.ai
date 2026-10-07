import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AssetIdentifierClaimContinuationSchema,
  type AssetIdentifierClaim,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { implementationARequest } from "./client";
const en = {
  respond: "Respond to evidence request",
  withdraw: "Withdraw identifier claim",
  reason: "Response or withdrawal reason",
  hint: "User-reported text only. No file evidence or physical verification is supplied; custody and identifiers remain unchanged.",
  review: "Review exact claim request",
  confirm: "Confirm reviewed claim request",
  retry: "Retry exact claim request",
  refresh: "Refresh current claim",
  saved: "Claim response saved.",
  refreshNeeded: "Claim saved. Refresh current records before another request.",
  unknown:
    "Result unverified. Keep this exact request; retry checks its saved operation first.",
  conflict: "Saved claim or permission changed. Refresh before another review.",
};
const es: Record<keyof typeof en, string> = {
  respond: "Responder a solicitud de evidencia",
  withdraw: "Retirar reclamación de identificador",
  reason: "Motivo de respuesta o retiro",
  hint: "Solo texto reportado por el usuario. No se adjuntan archivos ni verificación física; custodia e identificadores no cambian.",
  review: "Revisar solicitud exacta",
  confirm: "Confirmar solicitud revisada",
  retry: "Reintentar solicitud exacta",
  refresh: "Actualizar reclamación",
  saved: "Respuesta guardada.",
  refreshNeeded: "Reclamación guardada. Actualice antes de otra solicitud.",
  unknown:
    "Resultado sin verificar. Conserve esta solicitud; reintentar consulta primero la operación guardada.",
  conflict:
    "Cambió la reclamación o el permiso. Actualice antes de otra revisión.",
};
type Claim = AssetIdentifierClaim & {
  canRespond?: boolean;
  canWithdraw?: boolean;
};
type Attempt = {
  action: "respond" | "withdraw";
  assetId: string;
  claimId: string;
  body: ReturnType<typeof AssetIdentifierClaimContinuationSchema.parse>;
};
export function InventoryClaimContinuation({
  identity,
  claim,
  onSaved,
}: {
  identity: string;
  claim: Claim;
  onSaved: () => Promise<unknown>;
}) {
  const { i18n } = useTranslation(),
    c = i18n.language.startsWith("es") ? es : en;
  const [reason, setReason] = useState(""),
    [action, setAction] = useState<Attempt["action"]>("respond"),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [unknown, setUnknown] = useState(false),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [savedVersion, setSavedVersion] = useState<number | null>(null);
  const scope = identity + ":" + claim.assetId + ":" + claim.id,
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
    setSavedVersion(null);
    setReason("");
    setUnknown(false);
    setConflict(false);
    setBusy(false);
    setMessage("");
  }, [scope]);
  function verify(value: AssetIdentifierClaim, sent: Attempt) {
    if (
      value.id !== sent.claimId ||
      value.assetId !== sent.assetId ||
      value.operationId !== sent.body.operationId ||
      value.version !== sent.body.expectedVersion + 1 ||
      value.status !==
        (sent.action === "respond" ? "pending_review" : "withdrawn") ||
      value.responseReason !== sent.body.reason ||
      value.physicalEvidenceVerified !== false ||
      value.ownershipTransferred !== false ||
      value.otherOwnerDisclosed !== false
    )
      throw Error("Unexpected receipt");
  }
  async function save() {
    if (!attempt) return;
    const sent = attempt,
      at = scope,
      isCurrent = () => alive.current && current.current === at;
    setBusy(true);
    let posted = false;
    try {
      let receipt: AssetIdentifierClaim | undefined;
      if (unknown) {
        const list = await implementationARequest<{
          claims: AssetIdentifierClaim[];
        }>("/assets/" + sent.assetId + "/identifier-claims");
        if (!isCurrent()) return;
        receipt = list.claims.find(
          (x) =>
            x.id === sent.claimId && x.operationId === sent.body.operationId,
        );
        if (receipt) verify(receipt, sent);
      }
      if (!receipt) {
        posted = true;
        receipt = await implementationARequest<AssetIdentifierClaim>(
          "/assets/" +
            sent.assetId +
            "/identifier-claims/" +
            sent.claimId +
            "/" +
            sent.action,
          { method: "POST", body: JSON.stringify(sent.body) },
        );
        if (!isCurrent()) return;
        verify(receipt, sent);
      }
      setAttempt(null);
      setSavedVersion(receipt.version);
      setUnknown(false);
      setMessage(c.saved);
      await onSaved().catch(() => {
        if (isCurrent()) setMessage(c.refreshNeeded);
      });
    } catch (error) {
      if (!isCurrent()) return;
      const definitive =
        posted &&
        /asset\.(version_conflict|claim_terminal|operation_reused|claim_not_found|not_found|asset_manager_required|current_session_required|current_membership_required)/.test(
          error instanceof Error ? error.message : "",
        );
      setConflict(definitive);
      setUnknown(!definitive);
      setMessage(definitive ? c.conflict : c.unknown);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const allowed =
    claim.requesterActions?.includes("respond") === true ||
    claim.requesterActions?.includes("withdraw") === true;
  const needsFresh = savedVersion !== null && claim.version < savedVersion;
  if (!allowed && !attempt && !needsFresh) return null;
  return (
    <section className="grid gap-2 rounded border p-3">
      <p>{c.hint}</p>
      {needsFresh ? (
        <PngPillButton
          disabled={busy}
          onClick={async () => {
            const at = scope;
            setBusy(true);
            try {
              await onSaved();
            } catch {
              if (alive.current && current.current === at)
                setMessage(c.refreshNeeded);
            } finally {
              if (alive.current && current.current === at) setBusy(false);
            }
          }}
        >
          {c.refresh}
        </PngPillButton>
      ) : !attempt ? (
        <>
          <label>
            {c.reason}
            <textarea
              aria-label={c.reason}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div>
            {claim.requesterActions?.includes("respond") === true && (
              <PngPillButton
                disabled={busy || !reason.trim()}
                onClick={() => {
                  setAction("respond");
                  setAttempt({
                    action: "respond",
                    assetId: claim.assetId,
                    claimId: claim.id,
                    body: AssetIdentifierClaimContinuationSchema.parse({
                      operationId: crypto.randomUUID(),
                      expectedVersion: claim.version,
                      reason: reason.trim(),
                      confirmed: true,
                    }),
                  });
                }}
              >
                {c.respond}
              </PngPillButton>
            )}
            {claim.requesterActions?.includes("withdraw") === true && (
              <PngPillButton
                disabled={busy || !reason.trim()}
                onClick={() => {
                  setAction("withdraw");
                  setAttempt({
                    action: "withdraw",
                    assetId: claim.assetId,
                    claimId: claim.id,
                    body: AssetIdentifierClaimContinuationSchema.parse({
                      operationId: crypto.randomUUID(),
                      expectedVersion: claim.version,
                      reason: reason.trim(),
                      confirmed: true,
                    }),
                  });
                }}
              >
                {c.withdraw}
              </PngPillButton>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            {c.review}: {action === "respond" ? c.respond : c.withdraw} · v
            {attempt.body.expectedVersion} · {attempt.body.reason}
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
                  setReason("");
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
