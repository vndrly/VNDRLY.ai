import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PngPillButton } from "@/components/png-pill-rollover";
import { implementationARequest } from "./client";
export type InventoryHold = {
  id: string;
  reason: string;
  placedAt: string;
  source: "inventory" | "fleet_maintenance";
  canRelease: boolean;
};
const en = {
  release: "Release selected Inventory hold",
  reason: "Reason for administrative release",
  review: "Review exact hold release",
  confirm: "Confirm reviewed release",
  retry: "Retry exact reviewed release",
  hint: "Only this selected hold will be released. Other holds and custody remain unchanged. This does not verify physical repair.",
  saved: "Selected hold release recorded.",
  unknown:
    "Release outcome is unverified. Retry this exact request; do not change its version or reason.",
  conflict:
    "The saved asset or permission changed. Refresh before preparing a new release.",
  refresh: "Refresh current holds",
};
const es: Record<keyof typeof en, string> = {
  release: "Liberar la retención de inventario seleccionada",
  reason: "Motivo de liberación administrativa",
  review: "Revisar la liberación exacta",
  confirm: "Confirmar la liberación revisada",
  retry: "Reintentar la liberación exacta revisada",
  hint: "Solo se liberará esta retención. Otras retenciones y la custodia permanecen sin cambios. Esto no verifica una reparación física.",
  saved: "Liberación de la retención seleccionada registrada.",
  unknown:
    "El resultado no está verificado. Reintente esta solicitud exacta sin cambiar su versión ni motivo.",
  conflict:
    "El activo o permiso guardado cambió. Actualice antes de preparar una nueva liberación.",
  refresh: "Actualizar retenciones actuales",
};
export function InventoryHoldRelease({
  assetId,
  version,
  holds,
  onSaved,
  actorIdentity = "",
}: {
  assetId: string;
  actorIdentity?: string;
  version: number;
  holds: InventoryHold[];
  onSaved: () => Promise<unknown>;
}) {
  const { i18n } = useTranslation(),
    c = i18n.language.startsWith("es") ? es : en;
  const [selected, setSelected] = useState<InventoryHold | null>(null),
    [reason, setReason] = useState(""),
    [intent, setIntent] = useState<{
      assetId: string;
      actorIdentity: string;
      holdId: string;
      operationId: string;
      expectedVersion: number;
      reason: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(true);
  const currentIdentity = useRef("");
  currentIdentity.current = JSON.stringify([assetId, actorIdentity]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setIntent(null); setSelected(null); setBusy(false); setReason(""); setUnknown(false); setConflict(false); setMessage("");
  }, [assetId, actorIdentity]);
  async function save() {
    if (!intent || busy || intent.assetId !== assetId || intent.actorIdentity !== actorIdentity) return;
    const requestIdentity = currentIdentity.current;
    const isCurrent = () => alive.current && currentIdentity.current === requestIdentity;
    setBusy(true);
    try {
      const { holdId, assetId: targetAssetId, actorIdentity: _actorIdentity, ...body } = intent;
      const result = await implementationARequest<{
        assetId: string;
        holdId: string;
        operationId: string;
        version: number;
        status: string;
        physicalRepairVerified: boolean;
      }>(
        `/assets/${encodeURIComponent(targetAssetId)}/holds/${encodeURIComponent(holdId)}/release`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (
        result.assetId !== targetAssetId ||
        result.holdId !== holdId ||
        result.operationId !== body.operationId ||
        result.version !== body.expectedVersion + 1 ||
        result.status !== "applied" ||
        result.physicalRepairVerified !== false
      )
        throw Error("unknown");
      if (!isCurrent()) return;
      setIntent(null);
      setSelected(null);
      setReason("");
      setUnknown(false);
      setMessage(c.saved);
      await onSaved();
    } catch (error) {
      if (!isCurrent()) return;
      const code = error instanceof Error ? error.message : "";
      const known =
        /version_conflict|not_found|current_session|membership|asset_manager|fleet_maintenance|hold_release_unavailable|operation_reused/.test(
          code,
        );
      setConflict(known);
      setUnknown(!known);
      setMessage(known ? c.conflict : c.unknown);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  return (
    <section className="space-y-2">
      {holds.map((hold) => (
        <div key={hold.id}>
          <p>{hold.reason}</p>
          {hold.source === "fleet_maintenance" ? (
            <p>
              {i18n.language.startsWith("es")
                ? "Revisión y liberación mediante mantenimiento de Fleet."
                : "Review and release through Fleet maintenance."}
            </p>
          ) : (
            hold.canRelease && (
              <PngPillButton
                disabled={busy || !!intent}
                onClick={() => {
                  setSelected(hold);
                  setMessage("");
                  setReason("");
                }}
              >
                {c.release}: {hold.reason}
              </PngPillButton>
            )
          )}
        </div>
      ))}
      {selected && !intent && (
        <>
          <label>
            {c.reason}
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <PngPillButton
            disabled={!reason.trim() || busy}
            onClick={() => {
              setIntent({
                assetId,
                actorIdentity,
                holdId: selected.id,
                operationId: crypto.randomUUID(),
                expectedVersion: version,
                reason: reason.trim(),
              });
              setConflict(false);
              setUnknown(false);
            }}
          >
            {c.review}
          </PngPillButton>
        </>
      )}
      {intent && (
        <>
          <p>{c.hint}</p>
          <p>
            {selected?.reason} · v{intent.expectedVersion} · {intent.reason}
          </p>
          {conflict ? (
            <PngPillButton
              disabled={busy}
              onClick={async () => {
                await onSaved();
                if (alive.current) {
                  setIntent(null);
                  setSelected(null);
                  setConflict(false);
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
