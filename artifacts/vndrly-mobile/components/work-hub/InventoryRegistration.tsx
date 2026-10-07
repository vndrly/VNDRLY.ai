import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  reviewAssetRegistration,
  recoverAssetRegistration,
  reviewAlias,
  recoverAlias,
} from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
type Owner = { type: "vendor" | "partner"; id: number };
type Attempt =
  | { kind: "create"; value: ReturnType<typeof reviewAssetRegistration> }
  | { kind: "alias"; value: ReturnType<typeof reviewAlias> };
export function InventoryRegistration({
  owner,
  canManage,
  assetId,
  version,
  onSaved,
}: {
  owner: Owner;
  canManage: boolean;
  assetId?: string;
  version?: number;
  onSaved: () => unknown | Promise<unknown>;
}) {
  const { t } = useTranslation(),
    colors = useColors();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [category, setCategory] = useState(""),
    [legalOwner, setLegalOwner] = useState(""),
    [kind, setKind] = useState("serial"),
    [identifier, setIdentifier] = useState(""),
    [jurisdiction, setJurisdiction] = useState(""),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(false),
    request = useRef<AbortController | null>(null),
    generation = useRef(0),
    key = useRef("");
  key.current = JSON.stringify([owner, assetId]);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      generation.current++;
      request.current?.abort();
      setAttempt(null);
      setSent(false);
      setOpen(false);
      setMessage("");
      setBusy(false);
      setName("");
      setCategory("");
      setLegalOwner("");
      setIdentifier("");
      setJurisdiction("");
      setKind("serial");
    };
    const u = subscribeUser(clear),
      v = subscribeToken(clear);
    return () => {
      alive.current = false;
      clear();
      u();
      v();
    };
  }, [owner.type, owner.id, assetId]);
  const review = () => {
    if (!canManage || sent) return;
    try {
      const alias = {
        kind,
        value: identifier,
        ...(jurisdiction ? { jurisdiction } : {}),
      };
      setAttempt(
        assetId
          ? { kind: "alias", value: reviewAlias(assetId, version!, alias) }
          : {
              kind: "create",
              value: reviewAssetRegistration({
                name,
                category,
                legalOwner,
                responsibleOwner: owner,
                aliases: [alias],
              }),
            },
      );
      setMessage("");
    } catch {
      setMessage(t("inventoryRegistration.required"));
    }
  };
  const submit = async () => {
    if (!attempt || request.current) return;
    const c = new AbortController(),
      k = key.current,
      g = generation.current,
      authScope = captureAuthScope();
    request.current = c;
    const current = () =>
      alive.current &&
      key.current === k &&
      generation.current === g &&
      !c.signal.aborted &&
      isAuthScopeCurrent(authScope);
    setBusy(true);
    setMessage("");
    let posted = false;
    const api = (p: string) => apiFetch(p, { signal: c.signal }, authScope);
    try {
      if (!current()) return;
      if (!sent) {
        if (!canManage) throw Error(t("inventoryRegistration.forbidden"));
        setSent(true);
        posted = true;
        await apiFetch(
          attempt.kind === "create"
            ? "/api/implementation-a/assets"
            : "/api/implementation-a/assets/" +
                attempt.value.assetId +
                "/aliases",
          { method: "POST", body: attempt.value.body, signal: c.signal },
          authScope,
        );
        if (!current()) return;
      }
      const found =
        attempt.kind === "create"
          ? await recoverAssetRegistration(attempt.value, api, current)
          : await recoverAlias(attempt.value, api, current);
      if (!current()) return;
      if (!found) {
        setMessage(t("inventoryRegistration.unknown"));
        return;
      }
      setMessage(t("inventoryRegistration.matching"));
      setOpen(false);
      setAttempt(null);
      setSent(false);
      try {
        await onSaved();
      } catch {
        if (current()) setMessage(t("inventoryRegistration.savedRefresh"));
      }
    } catch (e) {
      if (current()) {
        const status = (e as { status?: number }).status;
        if (posted && [400, 409].includes(status ?? 0)) {
          setSent(false);
          setAttempt(null);
          setMessage(t("inventoryRegistration.refused"));
        } else setMessage(t("inventoryRegistration.unknown"));
      }
    } finally {
      if (current()) setBusy(false);
      if (request.current === c) request.current = null;
    }
  };
  if (!canManage && !attempt) return null;
  const labels: Record<string, string> = {
    name: t("inventoryRegistration.name"),
    category: t("inventoryRegistration.category"),
    legalOwner: t("inventoryRegistration.legalOwner"),
    identifier: t("inventoryRegistration.identifier"),
    jurisdiction: t("inventoryRegistration.jurisdiction"),
  };
  const kinds: Record<string, string> = {
    serial: t("inventoryRegistration.kinds.serial"),
    asset_tag: t("inventoryRegistration.kinds.asset_tag"),
    vin: t("inventoryRegistration.kinds.vin"),
    plate: t("inventoryRegistration.kinds.plate"),
    model: t("inventoryRegistration.kinds.model"),
    other: t("inventoryRegistration.kinds.other"),
  };
  const edit = () => {
    if (!sent) setAttempt(null);
  };
  const field = (label: string, value: string, set: (s: string) => void) => (
    <TextInput
      accessibilityLabel={labels[label]}
      placeholder={labels[label]}
      value={value}
      editable={!busy && !sent}
      onChangeText={(v) => {
        set(v);
        edit();
      }}
      style={{
        color: colors.text,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 10,
      }}
    />
  );
  return (
    <View style={{ gap: 8 }}>
      <TogglePillButton
        color="blue"
        disabled={busy || sent}
        onPress={() => setOpen(true)}
      >
        {t(
          assetId
            ? "inventoryRegistration.addAlias"
            : "inventoryRegistration.register",
        )}
      </TogglePillButton>
      {open && (
        <>
          <Text>{t("inventoryRegistration.hint")}</Text>
          {!assetId && (
            <>
              {field("name", name, setName)}
              {field("category", category, setCategory)}
              {field("legalOwner", legalOwner, setLegalOwner)}
            </>
          )}
          <Text>{t("inventoryRegistration.kind")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {["serial", "asset_tag", "vin", "plate", "model", "other"].map(
              (k) => (
                <TogglePillButton
                  key={k}
                  color="blue"
                  solid={kind === k}
                  disabled={busy || sent}
                  onPress={() => {
                    setKind(k);
                    edit();
                  }}
                >
                  {kinds[k]}
                </TogglePillButton>
              ),
            )}
          </View>
          {field("identifier", identifier, setIdentifier)}
          {field("jurisdiction", jurisdiction, setJurisdiction)}
          {attempt ? (
            <>
              <Text>
                {attempt.kind === "create"
                  ? `${attempt.value.input.name} · ${attempt.value.input.category} · ${attempt.value.input.legalOwner}`
                  : attempt.value.input.alias.value}
              </Text>
              <TogglePillButton
                color="blue"
                disabled={busy}
                onPress={() => void submit()}
              >
                {t(
                  sent
                    ? "inventoryRegistration.check"
                    : "inventoryRegistration.confirm",
                )}
              </TogglePillButton>
            </>
          ) : (
            <TogglePillButton color="blue" disabled={busy} onPress={review}>
              {t("inventoryRegistration.review")}
            </TogglePillButton>
          )}
        </>
      )}
      {message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
