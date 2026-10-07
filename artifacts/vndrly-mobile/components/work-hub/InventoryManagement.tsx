import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  InventoryPolicyReadSchema,
  inventoryManagementFingerprintValues,
  reviewInventoryManagement,
  submitInventoryManagement,
  InventoryManagementAbsentConflict,
  type InventoryManagementAttempt,
} from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
  getUser,
} from "@/lib/auth";
type Asset = {
  id: string;
  name: string;
  category: string;
  version: number;
  status: string;
  holderUserId?: number | null;
};
type Owner = { type: "vendor" | "partner"; id: number };
const fields = [
  "identifierRequired",
  "photosRequiredOnCheckout",
  "photosRequiredOnReturn",
  "supervisorApprovalRequired",
  "expectedReturnRequired",
] as const;
type Policy = Record<(typeof fields)[number], boolean>;
export function InventoryManagement({
  owner,
  asset,
  assets,
  canManage,
  onSaved,
}: {
  owner: Owner;
  asset: Asset;
  assets: Asset[];
  canManage: boolean;
  onSaved: () => unknown | Promise<unknown>;
}) {
  const { t } = useTranslation(),
    [mode, setMode] = useState<"policy" | "merge" | null>(null),
    [policy, setPolicy] = useState<Policy | null>(null),
    [policyVersion, setPolicyVersion] = useState(0),
    [duplicate, setDuplicate] = useState(""),
    [reason, setReason] = useState(""),
    [attempt, setAttempt] = useState<InventoryManagementAttempt | null>(null),
    [reviewLabel, setReviewLabel] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    inflight = useRef(false),
    key = useRef("");
  key.current = JSON.stringify([owner, asset.id]);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      generation.current++;
      controller.current?.abort();
      setMode(null);
      setPolicy(null);
      setAttempt(null);
      setSent(false);
      setReason("");
      setDuplicate("");
      setReviewLabel("");
      setMessage("");
      setBusy(false);
    };
    clear();
    const u = subscribeUser(clear),
      v = subscribeToken(clear);
    return () => {
      alive.current = false;
      clear();
      u();
      v();
    };
  }, [owner.type, owner.id, asset.id]);
  async function run(
    work: (
      current: () => void,
      api: (
        method: "GET" | "POST" | "PUT",
        path: string,
        body?: string,
      ) => Promise<unknown>,
    ) => Promise<void>,
  ) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const k = key.current,
      g = generation.current,
      c = new AbortController(),
      scope = captureAuthScope();
    controller.current = c;
    const current = () => {
      if (
        !alive.current ||
        g !== generation.current ||
        k !== key.current ||
        c.signal.aborted ||
        !isAuthScopeCurrent(scope)
      )
        throw Error("Account changed");
    };
    try {
      current();
      await work(current, async (m, p, b) => {
        current();
        const r = await apiFetch(
          p,
          { method: m, ...(b ? { body: b } : {}), signal: c.signal },
          scope,
        );
        current();
        return r;
      });
    } catch (error) {
      if (
        alive.current &&
        g === generation.current &&
        isAuthScopeCurrent(scope)
      ) {
        if (error instanceof InventoryManagementAbsentConflict) {
          setAttempt(null);
          setSent(false);
          setPolicy(null);
          setMode(null);
          setMessage(t("inventoryManagement.conflict"));
        } else
          setMessage(
            t(
              sent || attempt
                ? "inventoryManagement.unknown"
                : "inventoryManagement.failed",
            ),
          );
      }
    } finally {
      inflight.current = false;
      if (alive.current && g === generation.current) setBusy(false);
    }
  }
  const open = (kind: "policy" | "merge") =>
    run(async (current, api) => {
      if (!canManage || attempt) return;
      setMessage("");
      setMode(kind);
      if (kind === "policy") {
        const p = InventoryPolicyReadSchema.parse(
          await api(
            "GET",
            `/api/implementation-a/assets/policies/${encodeURIComponent(asset.category)}`,
          ),
        );
        current();
        if (
          p.owner.type !== owner.type ||
          p.owner.id !== owner.id ||
          p.category !== asset.category
        )
          throw Error("Policy mismatch");
        setPolicy(p.policy);
        setPolicyVersion(p.version);
      }
    });
  const review = () =>
    run(async (current, api) => {
      if (!canManage || attempt || !mode) return;
      const userId = (await getUser())?.id;
      current();
      if (!userId) throw Error("Current account required");
      let input: unknown,
        targetId = asset.id,
        label = asset.category;
      if (mode === "policy") {
        if (!policy) throw Error("No policy");
        targetId = asset.category;
        input = {
          operationId: Crypto.randomUUID(),
          expectedVersion: policyVersion,
          confirmed: true,
          policy,
        };
      } else {
        const other = assets.find((x) => x.id === duplicate);
        if (!other || other.id === asset.id) throw Error("No duplicate");
        for (const a of [asset, other]) {
          const r = (await api(
            "GET",
            `/api/implementation-a/assets/${a.id}`,
          )) as Asset & { responsibleOwner: Owner };
          if (
            r.id !== a.id ||
            r.version !== a.version ||
            r.responsibleOwner.type !== owner.type ||
            r.responsibleOwner.id !== owner.id ||
            r.status !== "available" ||
            r.holderUserId
          )
            throw Error("Fresh assets required");
        }
        label = `${asset.name} ← ${other.name}`;
        input = {
          operationId: Crypto.randomUUID(),
          expectedVersion: asset.version,
          mergedAssetId: other.id,
          mergedExpectedVersion: other.version,
          reason,
          confirmed: true,
        };
      }
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(
          inventoryManagementFingerprintValues(
            mode,
            userId,
            owner,
            targetId,
            input,
          ),
        ),
      );
      current();
      setReviewLabel(label);
      setAttempt(
        reviewInventoryManagement(
          { action: mode, actorUserId: userId, owner, targetId, input },
          hash,
        ),
      );
    });
  const save = () =>
    run(async (current, api) => {
      if (!attempt) return;
      setSent(true);
      await submitInventoryManagement(attempt, api, current);
      current();
      setAttempt(null);
      setSent(false);
      setMode(null);
      setPolicy(null);
      setMessage(t("inventoryManagement.saved"));
      try {
        await onSaved();
        current();
      } catch {
        current();
        setMessage(t("inventoryManagement.savedRefresh"));
      }
    });
  if (!canManage && !attempt) return null;
  const locked = busy || !!attempt;
  return (
    <View>
      <TogglePillButton
        disabled={busy || !!attempt || !canManage}
        onPress={() => void open("policy")}
      >
        {t("inventoryManagement.policy")}
      </TogglePillButton>
      <TogglePillButton
        disabled={
          busy ||
          !!attempt ||
          !canManage ||
          asset.status !== "available" ||
          !!asset.holderUserId
        }
        onPress={() => void open("merge")}
      >
        {t("inventoryManagement.merge")}
      </TogglePillButton>
      {mode === "policy" &&
        policy &&
        fields.map((f) => (
          <TogglePillButton
            key={f}
            accessibilityState={{ selected: policy[f] }}
            disabled={locked}
            solid={policy[f]}
            onPress={() => setPolicy({ ...policy, [f]: !policy[f] })}
          >
            {t(`inventoryManagement.${f}`)}
          </TogglePillButton>
        ))}
      {mode === "merge" && (
        <View>
          <Text>{t("inventoryManagement.duplicate")}</Text>
          {assets
            .filter(
              (a) =>
                a.id !== asset.id &&
                a.status === "available" &&
                !a.holderUserId,
            )
            .map((a) => (
              <TogglePillButton
                key={a.id}
                accessibilityState={{ selected: duplicate === a.id }}
                disabled={locked}
                onPress={() => setDuplicate(a.id)}
              >
                {a.name}
              </TogglePillButton>
            ))}
          <TextInput
            accessibilityLabel={t("inventoryManagement.reason")}
            editable={!locked}
            value={reason}
            onChangeText={setReason}
            maxLength={2000}
          />
        </View>
      )}
      {mode && !attempt && (
        <TogglePillButton
          disabled={busy || !canManage}
          onPress={() => void review()}
        >
          {t("inventoryManagement.review")}
        </TogglePillButton>
      )}
      {attempt && (
        <View>
          <Text>{reviewLabel}</Text>
          <Text>
            {t("inventoryManagement.version", {
              version: attempt.input.expectedVersion,
            })}
          </Text>
          {attempt.action === "merge" ? (
            <Text>
              {attempt.input.reason} ·{" "}
              {t("inventoryManagement.version", {
                version: attempt.input.mergedExpectedVersion,
              })}
            </Text>
          ) : (
            fields.map((f) => (
              <Text key={f}>
                {t(`inventoryManagement.${f}`)}:{" "}
                {t(
                  attempt.input.policy[f]
                    ? "inventoryManagement.enabled"
                    : "inventoryManagement.disabled",
                )}
              </Text>
            ))
          )}
          <Text>{t("inventoryManagement.boundary")}</Text>
          <TogglePillButton disabled={busy} onPress={() => void save()}>
            {t(sent ? "inventoryManagement.retry" : "inventoryManagement.save")}
          </TogglePillButton>
        </View>
      )}
      {message && <Text>{message}</Text>}
    </View>
  );
}
