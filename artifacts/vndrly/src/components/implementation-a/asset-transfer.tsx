import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AssetTransferInputSchema,
  AssetTransferReadbackSchema,
  AssetTransferRecipientsSchema,
  assetTransferFingerprintValues,
  type AssetTransferInput,
  type AssetTransferRecipients,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { implementationARequest } from "./client";
const en = {
  open: "Prepare custody transfer",
  recipient: "Recipient",
  condition: "Observed condition",
  note: "Transfer note",
  review: "Review exact transfer",
  confirm: "Confirm reviewed transfer",
  retry: "Retry exact reviewed transfer",
  hint: "This records custody only. It does not verify a physical handoff or transfer ownership.",
  unknown:
    "Transfer outcome is unverified. Keep this exact reviewed request for recovery.",
  conflict:
    "The saved asset or permission changed. Refresh and review again after the original operation is confirmed absent.",
  saved: "Custody transfer recorded.",
  refresh: "Refresh current Inventory",
  reviewAgain: "Review a new transfer",
  unavailable: "Transfer choices are unavailable for this current account.",
  savedRefresh: "Transfer recorded; current Inventory could not be refreshed.",
};
const es: Record<keyof typeof en, string> = {
  open: "Preparar transferencia de custodia",
  recipient: "Destinatario",
  condition: "Condición observada",
  note: "Nota de transferencia",
  review: "Revisar transferencia exacta",
  confirm: "Confirmar transferencia revisada",
  retry: "Reintentar transferencia exacta revisada",
  hint: "Esto registra solo la custodia. No verifica una entrega física ni transfiere la propiedad.",
  unknown:
    "El resultado no está verificado. Conserve esta solicitud exacta para recuperarlo.",
  conflict:
    "El activo o permiso cambió. Actualice y revise después de confirmar que la operación original no existe.",
  saved: "Transferencia de custodia registrada.",
  refresh: "Actualizar inventario actual",
  reviewAgain: "Revisar nueva transferencia",
  unavailable:
    "Los destinatarios no están disponibles para esta cuenta actual.",
  savedRefresh:
    "Transferencia registrada; no se pudo actualizar el inventario actual.",
};
type Attempt = {
  input: AssetTransferInput;
  fromHolderUserId: number;
  actorUserId: number;
  recipientName: string;
};
export function InventoryTransfer({
  assetId,
  assetName,
  userId,
  identity,
  canTransfer,
  onSaved,
}: {
  assetId: string;
  assetName: string;
  userId: number;
  identity: string;
  canTransfer: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const { i18n } = useTranslation(),
    c = i18n.language.startsWith("es") ? es : en;
  const [choices, setChoices] = useState<AssetTransferRecipients | null>(null),
    [recipient, setRecipient] = useState(""),
    [condition, setCondition] = useState(""),
    [note, setNote] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [unknown, setUnknown] = useState(false),
    [absentConflict, setAbsentConflict] = useState(false),
    [saved, setSaved] = useState(false);
  const alive = useRef(true),
    sending = useRef(false),
    scope = useRef("");
  scope.current = JSON.stringify([identity, assetId, userId]);
  useEffect(() => {
    alive.current = true;
    setChoices(null);
    setAttempt(null);
    setMessage("");
    setSaved(false);
    setUnknown(false);
    setAbsentConflict(false);
    return () => {
      alive.current = false;
    };
  }, [identity, assetId, userId]);
  const path = `/assets/${assetId}`;
  const current = (key: string) => alive.current && scope.current === key;
  async function readChoices(key: string) {
    const value = AssetTransferRecipientsSchema.parse(
      await implementationARequest(`${path}/transfer-recipients`),
    );
    if (
      !current(key) ||
      value.assetId !== assetId ||
      value.actorUserId !== userId ||
      !value.canTransfer
    )
      throw new Error("scope changed");
    return value;
  }
  async function open() {
    const key = scope.current;
    setBusy(true);
    setMessage("");
    try {
      const value = await readChoices(key);
      if (current(key)) {
        setChoices(value);
        setSaved(false);
      }
    } catch {
      if (current(key)) {
        setChoices(null);
        setMessage(c.unavailable);
      }
    } finally {
      if (current(key)) setBusy(false);
    }
  }
  function review() {
    if (
      !choices ||
      choices.actorUserId !== userId ||
      !choices.recipients.some((row) => row.userId === Number(recipient))
    )
      return;
    const parsed = AssetTransferInputSchema.safeParse({
      operationId: crypto.randomUUID(),
      expectedVersion: choices.version,
      toHolderUserId: Number(recipient),
      condition,
      confirmed: true,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) return;
    setAttempt({
      input: parsed.data,
      fromHolderUserId: choices.holderUserId,
      actorUserId: userId,
      recipientName: choices.recipients.find(
        (row) => row.userId === parsed.data.toHolderUserId,
      )!.displayName,
    });
    setUnknown(false);
    setAbsentConflict(false);
    setMessage("");
  }
  async function execute() {
    if (!attempt || sending.current) return;
    const exact = attempt,
      key = scope.current;
    sending.current = true;
    setBusy(true);
    try {
      const encoded = new TextEncoder().encode(
        JSON.stringify(
          assetTransferFingerprintValues(
            assetId,
            exact.actorUserId,
            exact.fromHolderUserId,
            exact.input,
          ),
        ),
      );
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      if (!current(key)) return;
      let result = AssetTransferReadbackSchema.parse(
        await implementationARequest(
          `${path}/transfers/${exact.input.operationId}`,
        ),
      );
      if (!current(key)) return;
      if (!result.receipt) {
        const fresh = await readChoices(key);
        if (!current(key)) return;
        if (
          fresh.version !== exact.input.expectedVersion ||
          fresh.holderUserId !== exact.fromHolderUserId ||
          !fresh.recipients.some(
            (row) => row.userId === exact.input.toHolderUserId,
          )
        ) {
          setAbsentConflict(true);
          setMessage(c.conflict);
          return;
        }
        await implementationARequest(`${path}/transfer`, {
          method: "POST",
          body: JSON.stringify(exact.input),
        });
        if (!current(key)) return;
        result = AssetTransferReadbackSchema.parse(
          await implementationARequest(
            `${path}/transfers/${exact.input.operationId}`,
          ),
        );
      }
      if (!current(key)) return;
      const receipt = result.receipt;
      if (
        !receipt ||
        receipt.assetId !== assetId ||
        receipt.actorUserId !== exact.actorUserId ||
        receipt.operationId !== exact.input.operationId ||
        receipt.fromHolderUserId !== exact.fromHolderUserId ||
        receipt.toHolderUserId !== exact.input.toHolderUserId ||
        receipt.condition !== exact.input.condition ||
        receipt.commandFingerprint !== digest
      )
        throw new Error("unverified receipt");
      setSaved(true);
      setAttempt(null);
      setChoices(null);
      setUnknown(false);
      setMessage(c.saved);
      try {
        await onSaved();
      } catch {
        if (current(key)) setMessage(c.savedRefresh);
      }
    } catch {
      if (current(key)) {
        setUnknown(true);
        setMessage(c.unknown);
      }
    } finally {
      sending.current = false;
      if (current(key)) setBusy(false);
    }
  }
  return (
    <section className="mt-3 grid gap-2">
      <p className="text-sm text-muted-foreground">{c.hint}</p>
      {!!message && <p role="status">{message}</p>}
      {!attempt && !saved && canTransfer && !choices && (
        <PngPillButton color="blue" disabled={busy} onClick={open}>
          {c.open}
        </PngPillButton>
      )}
      {choices && !attempt && !saved && (
        <>
          <label>
            {c.recipient}
            <select
              aria-label={c.recipient}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            >
              <option value="">—</option>
              {choices.recipients.map((row) => (
                <option key={row.userId} value={row.userId}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.condition}
            <select
              aria-label={c.condition}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="">—</option>
              {["new", "good", "fair", "damaged", "missing", "stolen"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <label>
            {c.note}
            <textarea
              aria-label={c.note}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {choices.truncated && (
            <p>
              {i18n.language.startsWith("es")
                ? "Se muestran los primeros 50 destinatarios."
                : "The first 50 recipients are shown."}
            </p>
          )}
          <PngPillButton
            color="blue"
            disabled={busy || !recipient || !condition}
            onClick={review}
          >
            {c.review}
          </PngPillButton>
        </>
      )}
      {attempt && (
        <>
          <p>
            {assetName} · {attempt.fromHolderUserId} → {attempt.recipientName} ·{" "}
            {attempt.input.condition} · {attempt.input.note} · v
            {attempt.input.expectedVersion}
          </p>
          {!absentConflict && (
            <PngPillButton color="blue" disabled={busy} onClick={execute}>
              {unknown ? c.retry : c.confirm}
            </PngPillButton>
          )}
          {absentConflict && (
            <PngPillButton
              color="blue"
              disabled={busy}
              onClick={() => {
                setAttempt(null);
                setChoices(null);
                setAbsentConflict(false);
                void open();
              }}
            >
              {c.reviewAgain}
            </PngPillButton>
          )}
        </>
      )}
      {saved && (
        <PngPillButton
          color="blue"
          disabled={busy}
          onClick={async () => {
            try {
              await onSaved();
            } catch {
              setMessage(c.savedRefresh);
            }
          }}
        >
          {c.refresh}
        </PngPillButton>
      )}
    </section>
  );
}
