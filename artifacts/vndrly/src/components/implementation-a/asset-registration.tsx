import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  reviewAssetRegistration,
  recoverAssetRegistration,
  reviewAlias,
  recoverAlias,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { inventoryRequest } from "./asset-custody";
type Owner = { type: "vendor" | "partner"; id: number };
type Attempt =
  | { kind: "create"; value: ReturnType<typeof reviewAssetRegistration> }
  | { kind: "alias"; value: ReturnType<typeof reviewAlias> };
export function InventoryRegistration({
  owner,
  identity,
  canManage,
  assetId,
  version,
  onSaved,
}: {
  owner: Owner;
  identity: string;
  canManage: boolean;
  assetId?: string;
  version?: number;
  onSaved: () => unknown | Promise<unknown>;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
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
    key = useRef("");
  key.current = JSON.stringify([identity, owner, assetId]);
  useEffect(() => {
    alive.current = true;
    setOpen(false);
    setAttempt(null);
    setSent(false);
    setMessage("");
    setName("");
    setCategory("");
    setLegalOwner("");
    setIdentifier("");
    setJurisdiction("");
    setKind("serial");
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, [identity, owner.type, owner.id, assetId]);
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
      k = key.current;
    request.current = c;
    const current = () =>
      alive.current && key.current === k && !c.signal.aborted;
    setBusy(true);
    setMessage("");
    let posted = false;
    const api = (p: string) => inventoryRequest(p, undefined, c.signal);
    try {
      if (!sent) {
        if (!canManage) throw Error(t("inventoryRegistration.forbidden"));
        setSent(true);
        posted = true;
        await inventoryRequest(
          attempt.kind === "create"
            ? "/api/implementation-a/assets"
            : "/api/implementation-a/assets/" +
                attempt.value.assetId +
                "/aliases",
          { method: "POST", body: attempt.value.body },
          c.signal,
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
  return (
    <div className="grid gap-2">
      <PngPillButton
        color="blue"
        disabled={busy || sent}
        onClick={() => setOpen(true)}
      >
        {t(
          assetId
            ? "inventoryRegistration.addAlias"
            : "inventoryRegistration.register",
        )}
      </PngPillButton>
      {open && (
        <>
          <p>{t("inventoryRegistration.hint")}</p>
          {!assetId && (
            <>
              {(
                [
                  ["name", name, setName],
                  ["category", category, setCategory],
                  ["legalOwner", legalOwner, setLegalOwner],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label}>
                  {labels[label]}
                  <input
                    aria-label={labels[label]}
                    value={value}
                    disabled={busy || sent}
                    onChange={(e) => {
                      set(e.target.value);
                      edit();
                    }}
                  />
                </label>
              ))}
            </>
          )}
          <label>
            {t("inventoryRegistration.kind")}
            <select
              disabled={busy || sent}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                edit();
              }}
            >
              {["serial", "asset_tag", "vin", "plate", "model", "other"].map(
                (k) => (
                  <option key={k} value={k}>
                    {kinds[k]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {t("inventoryRegistration.identifier")}
            <input
              aria-label={t("inventoryRegistration.identifier")}
              value={identifier}
              disabled={busy || sent}
              onChange={(e) => {
                setIdentifier(e.target.value);
                edit();
              }}
            />
          </label>
          <label>
            {t("inventoryRegistration.jurisdiction")}
            <input
              value={jurisdiction}
              disabled={busy || sent}
              onChange={(e) => {
                setJurisdiction(e.target.value);
                edit();
              }}
            />
          </label>
          {attempt ? (
            <>
              <p>
                {attempt.kind === "create"
                  ? `${attempt.value.input.name} · ${attempt.value.input.category} · ${attempt.value.input.legalOwner}`
                  : attempt.value.input.alias.value}
              </p>
              <PngPillButton
                color="blue"
                disabled={busy}
                onClick={() => void submit()}
              >
                {t(
                  sent
                    ? "inventoryRegistration.check"
                    : "inventoryRegistration.confirm",
                )}
              </PngPillButton>
            </>
          ) : (
            <PngPillButton color="blue" disabled={busy} onClick={review}>
              {t("inventoryRegistration.review")}
            </PngPillButton>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
