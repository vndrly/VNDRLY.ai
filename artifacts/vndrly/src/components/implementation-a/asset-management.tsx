import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InventoryPolicyReadSchema,
  inventoryManagementFingerprintValues,
  reviewInventoryManagement,
  submitInventoryManagement,
  InventoryManagementAbsentConflict,
  type InventoryManagementAttempt,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { inventoryRequest } from "./asset-custody";
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
  identity,
  userId,
  asset,
  assets,
  canManage,
  onSaved,
}: {
  owner: Owner;
  identity: string;
  userId: number;
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
  key.current = JSON.stringify([identity, owner, userId, asset.id]);
  useEffect(() => {
    alive.current = true;
    generation.current++;
    setMode(null);
    setPolicy(null);
    setAttempt(null);
    setSent(false);
    setReason("");
    setDuplicate("");
    setReviewLabel("");
    setMessage("");
    setBusy(false);
    return () => {
      alive.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, [identity, owner.type, owner.id, userId, asset.id]);
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
      c = new AbortController();
    controller.current = c;
    const current = () => {
      if (
        !alive.current ||
        g !== generation.current ||
        k !== key.current ||
        c.signal.aborted
      )
        throw Error("Account changed");
    };
    try {
      await work(current, async (m, p, b) => {
        current();
        const r = await inventoryRequest(
          p,
          m === "GET" ? undefined : { method: m, body: b! },
          c.signal,
        );
        current();
        return r;
      });
    } catch (error) {
      if (alive.current && g === generation.current) {
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
      let input: unknown,
        targetId = asset.id,
        label = asset.category;
      if (mode === "policy") {
        if (!policy) throw Error("No policy");
        targetId = asset.category;
        input = {
          operationId: crypto.randomUUID(),
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
          operationId: crypto.randomUUID(),
          expectedVersion: asset.version,
          mergedAssetId: other.id,
          mergedExpectedVersion: other.version,
          reason,
          confirmed: true,
        };
      }
      const raw = { action: mode, actorUserId: userId, owner, targetId, input };
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify(
            inventoryManagementFingerprintValues(
              mode,
              userId,
              owner,
              targetId,
              input,
            ),
          ),
        ),
      );
      current();
      setReviewLabel(label);
      setAttempt(
        reviewInventoryManagement(
          raw,
          Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
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
    <section aria-label={t("inventoryManagement.title")}>
      <PngPillButton
        color="blue"
        disabled={busy || !!attempt || !canManage}
        onClick={() => void open("policy")}
      >
        {t("inventoryManagement.policy")}
      </PngPillButton>
      <PngPillButton
        color="amber"
        disabled={
          busy ||
          !!attempt ||
          !canManage ||
          asset.status !== "available" ||
          !!asset.holderUserId
        }
        onClick={() => void open("merge")}
      >
        {t("inventoryManagement.merge")}
      </PngPillButton>
      {mode === "policy" && policy && (
        <div>
          {fields.map((field) => (
            <PngPillButton
              key={field}
              color={policy[field] ? "green" : "blue"}
              disabled={locked}
              aria-pressed={policy[field]}
              onClick={() => setPolicy({ ...policy, [field]: !policy[field] })}
            >
              {t(`inventoryManagement.${field}`)}
            </PngPillButton>
          ))}
        </div>
      )}
      {mode === "merge" && (
        <div>
          <label>
            {t("inventoryManagement.duplicate")}
            <select
              disabled={locked}
              value={duplicate}
              onChange={(e) => setDuplicate(e.target.value)}
            >
              <option value="">{t("inventoryManagement.choose")}</option>
              {assets
                .filter(
                  (a) =>
                    a.id !== asset.id &&
                    a.status === "available" &&
                    !a.holderUserId,
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("inventoryManagement.reason")}
            <textarea
              disabled={locked}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          </label>
        </div>
      )}
      {mode && !attempt && (
        <PngPillButton
          color="blue"
          disabled={busy || !canManage}
          onClick={() => void review()}
        >
          {t("inventoryManagement.review")}
        </PngPillButton>
      )}
      {attempt && (
        <div>
          <p>{reviewLabel}</p>
          <p>
            {t("inventoryManagement.version", {
              version: attempt.input.expectedVersion,
            })}
          </p>
          {attempt.action === "merge" ? (
            <p>
              {attempt.input.reason} ·{" "}
              {t("inventoryManagement.version", {
                version: attempt.input.mergedExpectedVersion,
              })}
            </p>
          ) : (
            fields.map((f) => (
              <p key={f}>
                {t(`inventoryManagement.${f}`)}:{" "}
                {t(
                  attempt.input.policy[f]
                    ? "inventoryManagement.enabled"
                    : "inventoryManagement.disabled",
                )}
              </p>
            ))
          )}
          <p>{t("inventoryManagement.boundary")}</p>
          <PngPillButton
            color="green"
            disabled={busy}
            onClick={() => void save()}
          >
            {t(sent ? "inventoryManagement.retry" : "inventoryManagement.save")}
          </PngPillButton>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
