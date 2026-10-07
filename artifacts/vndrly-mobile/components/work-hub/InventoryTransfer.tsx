import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  AssetConditionSchema,
  AssetTransferRecipientsSchema,
  assetTransferFingerprintValues,
  type AssetTransferRecipients,
  type AssetTransferInput,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  getUser,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
import {
  AbsentTransferConflict,
  makeTransferAttempt,
  submitTransferAttempt,
  type TransferAttempt,
} from "@/lib/inventory-transfer";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
type Props = {
  canTransfer?: boolean;
  assetId: string;
  owner: { type: "vendor" | "partner"; id: number };
  onRefresh: () => void | Promise<void>;
};
const words = {
  en: {
    open: "Transfer custody",
    refresh: "Read current transfer choices",
    unavailable: "Transfer unavailable in the current account.",
    review: "Review transfer",
    confirm: "Confirm reviewed transfer",
    retry: "Check original transfer",
    conflict:
      "Original transfer is absent and custody changed. Review a fresh request.",
    reviewAgain: "Review current custody",
    saved:
      "Canonical transfer record saved. Read current custody before another action.",
    unknown: "Transfer result unverified. Keep the exact original request.",
    boundary:
      "Physical handoff and ownership are not verified. This records custody within the current company.",
    condition: "Recorded condition",
    note: "Transfer note",
    partial: "Recipient list is partial.",
    holder: "Current recorded holder",
    to: "Selected recipient",
  },
  es: {
    open: "Transferir custodia",
    refresh: "Leer opciones actuales de transferencia",
    unavailable: "Transferencia no disponible en la cuenta actual.",
    review: "Revisar transferencia",
    confirm: "Confirmar transferencia revisada",
    retry: "Consultar transferencia original",
    conflict:
      "La transferencia original no existe y cambió la custodia. Revisa una solicitud nueva.",
    reviewAgain: "Revisar custodia actual",
    saved:
      "Registro de transferencia guardado. Lee la custodia actual antes de otra acción.",
    unknown: "Resultado sin verificar. Conserva la solicitud original exacta.",
    boundary:
      "No se verifican la entrega física ni la propiedad. Se registra custodia dentro de la empresa actual.",
    condition: "Condición registrada",
    note: "Nota de transferencia",
    partial: "La lista de destinatarios es parcial.",
    holder: "Custodio registrado actual",
    to: "Destinatario seleccionado",
  },
};
const conditions = {
  en: {
    new: "New",
    good: "Good",
    fair: "Fair",
    damaged: "Damaged",
    missing: "Missing",
    stolen: "Stolen",
  },
  es: {
    new: "Nuevo",
    good: "Bueno",
    fair: "Regular",
    damaged: "Dañado",
    missing: "Extraviado",
    stolen: "Robado",
  },
};
export function InventoryTransfer(props: Props) {
  return (
    <Panel
      key={`${props.owner.type}:${props.owner.id}:${props.assetId}`}
      {...props}
    />
  );
}
function Panel({ assetId, owner, onRefresh, canTransfer = true }: Props) {
  const { i18n } = useTranslation(),
    lang = (i18n?.language ?? "en").startsWith("es") ? "es" : "en",
    c = words[lang],
    colors = useColors();
  const [open, setOpen] = useState(false),
    [choices, setChoices] = useState<AssetTransferRecipients | null>(null),
    [recipient, setRecipient] = useState<number | null>(null),
    [condition, setCondition] = useState<
      AssetTransferInput["condition"] | null
    >(null),
    [note, setNote] = useState(""),
    [attempt, setAttempt] = useState<TransferAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(false);
  const generation = useRef(0),
    alive = useRef(true),
    sending = useRef(false);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      generation.current++;
      setChoices(null);
      setAttempt(null);
      setRecipient(null);
      setCondition(null);
      setNote("");
      setMessage(c.unavailable);
    };
    const a = subscribeUser(invalidate),
      b = subscribeToken(invalidate);
    return () => {
      alive.current = false;
      generation.current++;
      a();
      b();
    };
  }, []);
  async function load() {
    if (sending.current) return;
    const n = ++generation.current,
      scope = captureAuthScope(),
      current = () =>
        alive.current && n === generation.current && isAuthScopeCurrent(scope);
    setBusy(true);
    setOpen(true);
    setChoices(null);
    setConflict(false);
    setRecipient(null);
    setCondition(null);
    setMessage("");
    try {
      const user = await getUser();
      if (
        !current() ||
        !user ||
        user.role === "admin" ||
        (owner.type === "vendor" ? user.vendorId : user.partnerId) !== owner.id
      )
        throw Error("Account changed");
      const parsed = AssetTransferRecipientsSchema.parse(
        await apiFetch(
          `/api/implementation-a/assets/${assetId}/transfer-recipients`,
          undefined,
          scope,
        ),
      );
      if (!current()) return;
      if (
        parsed.assetId !== assetId ||
        parsed.actorUserId !== user.id ||
        !parsed.canTransfer ||
        parsed.recipients.some((r) => r.userId === parsed.holderUserId) ||
        new Set(parsed.recipients.map((r) => r.userId)).size !==
          parsed.recipients.length
      )
        throw Error("Transfer unavailable");
      setChoices(parsed);
    } catch {
      if (current()) setMessage(c.unavailable);
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function review() {
    if (
      !canTransfer ||
      sending.current ||
      !choices ||
      !recipient ||
      !condition ||
      attempt
    )
      return;
    sending.current = true;
    const n = generation.current,
      scope = captureAuthScope(),
      current = () =>
        alive.current && n === generation.current && isAuthScopeCurrent(scope);
    setBusy(true);
    try {
      if (!choices.recipients.some((r) => r.userId === recipient))
        throw Error("Recipient changed");
      const input: AssetTransferInput = {
        operationId: Crypto.randomUUID(),
        expectedVersion: choices.version,
        toHolderUserId: recipient,
        condition,
        confirmed: true,
        note: note.trim(),
        photos: [],
      };
      const fingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(
          assetTransferFingerprintValues(
            assetId,
            choices.actorUserId,
            choices.holderUserId,
            input,
          ),
        ),
      );
      if (current())
        setAttempt(
          makeTransferAttempt(
            assetId,
            input,
            choices.actorUserId,
            choices.holderUserId,
            fingerprint,
          ),
        );
    } catch {
      if (current()) setMessage(c.unavailable);
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  }
  async function save() {
    if (!attempt || sending.current) return;
    sending.current = true;
    const n = generation.current,
      scope = captureAuthScope(),
      current = () =>
        alive.current && n === generation.current && isAuthScopeCurrent(scope);
    setBusy(true);
    try {
      await submitTransferAttempt(
        attempt,
        (path, init) => apiFetch(path, init, scope),
        current,
      );
      if (!current()) return;
      setAttempt(null);
      setChoices(null);
      setMessage(c.saved);
      try {
        await onRefresh();
      } catch {
        // A refresh failure does not erase the independently verified saved event.
      }
    } catch (error) {
      if (current()) {
        if (error instanceof AbsentTransferConflict) setConflict(true);
        setMessage(
          error instanceof AbsentTransferConflict ? c.conflict : c.unknown,
        );
      }
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  }
  if (!open && !canTransfer) return null;
  return (
    <View style={{ gap: 8 }}>
      {!open ? (
        <TogglePillButton onPress={() => void load()}>
          {c.open}
        </TogglePillButton>
      ) : (
        <>
          <Text style={{ color: colors.text }}>{c.boundary}</Text>
          {!attempt && (
            <TogglePillButton disabled={busy} onPress={() => void load()}>
              {c.refresh}
            </TogglePillButton>
          )}
          {message && <Text style={{ color: colors.text }}>{message}</Text>}
          {choices && (
            <>
              <Text style={{ color: colors.text }}>
                {c.holder}: {choices.holderUserId}
              </Text>
              {choices.truncated && <Text>{c.partial}</Text>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {choices.recipients.map((r) => (
                  <TogglePillButton
                    key={r.userId}
                    disabled={busy || !!attempt || !canTransfer}
                    solid={recipient === r.userId}
                    onPress={() => setRecipient(r.userId)}
                  >
                    {r.displayName}
                  </TogglePillButton>
                ))}
              </View>
              <Text style={{ color: colors.text }}>{c.condition}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {AssetConditionSchema.options.map((value) => (
                  <TogglePillButton
                    key={value}
                    disabled={busy || !!attempt || !canTransfer}
                    solid={condition === value}
                    onPress={() => setCondition(value)}
                  >
                    {conditions[lang][value]}
                  </TogglePillButton>
                ))}
              </View>
              <TextInput
                accessibilityLabel={c.note}
                value={note}
                editable={!busy && !attempt}
                onChangeText={setNote}
                maxLength={2000}
                style={{
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 10,
                }}
              />
              {!attempt && (
                <TogglePillButton
                  disabled={busy || !canTransfer || !recipient || !condition}
                  onPress={() => void review()}
                >
                  {c.review}
                </TogglePillButton>
              )}
            </>
          )}
          {attempt && (
            <>
              <Text style={{ color: colors.text }}>
                {c.to}:{" "}
                {choices?.recipients.find(
                  (r) => r.userId === attempt.input.toHolderUserId,
                )?.displayName ?? attempt.input.toHolderUserId}
                {" · "}
                {conditions[lang][attempt.input.condition]}
                {" · "}
                {attempt.input.note}
              </Text>
              {conflict ? (
                <TogglePillButton
                  disabled={busy || !canTransfer}
                  onPress={() => {
                    setAttempt(null);
                    void load();
                  }}
                >
                  {c.reviewAgain}
                </TogglePillButton>
              ) : (
                <TogglePillButton disabled={busy} onPress={() => void save()}>
                  {message === c.unknown ? c.retry : c.confirm}
                </TogglePillButton>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
