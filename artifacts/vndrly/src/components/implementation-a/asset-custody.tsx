import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  makeCustodyAttempt,
  custodyFingerprintValues,
  submitCustodyAttempt,
  CustodyAbsentConflict,
  type CustodyAttempt,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  uploadFleetEvidence,
  type FleetEvidenceUpload,
} from "@/lib/fleet-evidence-upload";
type Action = "checkout" | "return" | "verify-issued";
export type CustodyAsset = {
  id: string;
  name: string;
  version: number;
  holderUserId: number | null;
  capabilities?: {
    canCheckOut?: boolean;
    canReturn?: boolean;
    canVerifyIssued?: boolean;
  };
  policy?: {
    photosRequiredOnCheckout: boolean;
    photosRequiredOnReturn: boolean;
    expectedReturnRequired: boolean;
  };
};
export async function inventoryRequest(
  path: string,
  init?: { method: string; body: string },
  signal?: AbortSignal,
): Promise<unknown> {
  const r = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
    signal,
  });
  const value = await r.json();
  if (!r.ok)
    throw Object.assign(Error(value.code ?? "Request failed"), {
      status: r.status,
    });
  return value;
}
export function InventoryCustody({
  asset,
  userId,
  identity,
  onSaved,
}: {
  asset: CustodyAsset;
  userId: number;
  identity: string;
  onSaved: () => Promise<unknown> | unknown;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<Action | null>(null),
    [condition, setCondition] = useState("good"),
    [date, setDate] = useState(""),
    [photos, setPhotos] = useState<string[]>([]),
    [attempt, setAttempt] = useState<CustodyAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(false),
    request = useRef<AbortController | null>(null),
    upload = useRef<FleetEvidenceUpload | null>(null),
    key = useRef("");
  key.current = JSON.stringify([identity, asset.id, userId]);
  useEffect(() => {
    alive.current = true;
    setAction(null);
    setAttempt(null);
    setUnknown(false);
    setMessage("");
    upload.current = null;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, [identity, asset.id, userId]);
  const run = async (
    work: (current: () => boolean, signal: AbortSignal) => Promise<void>,
  ) => {
    if (request.current) return;
    const c = new AbortController(),
      k = key.current;
    request.current = c;
    const current = () =>
      alive.current && key.current === k && !c.signal.aborted;
    setBusy(true);
    setMessage("");
    try {
      await work(current, c.signal);
    } catch (e) {
      if (current())
        setMessage(
          e instanceof CustodyAbsentConflict
            ? t("inventoryCustody.conflict")
            : e instanceof Error
              ? e.message
              : t("inventoryCustody.failed"),
        );
      if (current() && e instanceof CustodyAbsentConflict) {
        setAttempt(null);
        setUnknown(false);
        setAction(null);
        await onSaved();
      }
    } finally {
      if (current()) setBusy(false);
      if (request.current === c) request.current = null;
    }
  };
  const can = (a: Action) =>
    a === "checkout"
      ? asset.capabilities?.canCheckOut
      : a === "return"
        ? asset.capabilities?.canReturn
        : asset.capabilities?.canVerifyIssued;
  const review = () =>
    void run(async (current, signal) => {
      if (!action || !can(action) || attempt) return;
      const d = (await inventoryRequest(
        "/api/implementation-a/assets/" + asset.id,
        undefined,
        signal,
      )) as { id: string; version: number; holderUserId: number | null };
      if (!current()) return;
      if (
        d.id !== asset.id ||
        d.version !== asset.version ||
        d.holderUserId !== asset.holderUserId
      )
        throw new CustodyAbsentConflict();
      const expectedReturnAt = date ? new Date(date).toISOString() : undefined;
      if (
        ((action === "checkout" && asset.policy?.photosRequiredOnCheckout) ||
          (action === "return" && asset.policy?.photosRequiredOnReturn)) &&
        !photos.length
      )
        throw Error(t("inventoryCustody.photoRequired"));
      if (
        action === "checkout" &&
        asset.policy?.expectedReturnRequired &&
        !expectedReturnAt
      )
        throw Error(t("inventoryCustody.dateRequired"));
      const raw = {
        assetId: asset.id,
        actorUserId: userId,
        holderUserId: d.holderUserId,
        action,
        input: {
          operationId: crypto.randomUUID(),
          expectedVersion: d.version,
          condition,
          confirmed: true,
          photos,
          ...(expectedReturnAt ? { expectedReturnAt } : {}),
        },
      };
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(custodyFingerprintValues(raw))),
      );
      if (!current()) return;
      setAttempt(
        makeCustodyAttempt(
          raw,
          Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
        ),
      );
    });
  const send = () =>
    void run(async (current, signal) => {
      if (!attempt) return;
      setUnknown(true);
      await submitCustodyAttempt(
        attempt,
        (p, i) => inventoryRequest(p, i, signal),
        current,
      );
      if (!current()) return;
      setAttempt(null);
      setAction(null);
      setUnknown(false);
      setMessage(t("inventoryCustody.saved"));
      try {
        await onSaved();
      } catch {
        if (current()) setMessage(t("inventoryCustody.savedRefresh"));
      }
    });
  const addPhoto = (file: File) =>
    void run(async (current) => {
      if (attempt) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw Error(t("inventoryCustody.imageRequired"));
      upload.current ??= { file };
      const path = await uploadFleetEvidence(upload.current, current);
      if (!current()) return;
      setPhotos((p) => [
        ...p,
        new URL("/api/storage" + path, window.location.origin).href,
      ]);
      upload.current = null;
    });
  return (
    <div className="grid gap-2">
      {(["checkout", "return", "verify-issued"] as Action[])
        .filter(can)
        .map((a) => (
          <PngPillButton
            key={a}
            color="blue"
            disabled={busy || !!attempt}
            onClick={() => {
              setAction(a);
              setPhotos([]);
              setDate("");
              setCondition("good");
            }}
          >
            {t(`inventoryCustody.${a}`)}
          </PngPillButton>
        ))}
      {action && (
        <>
          <p>{t("inventoryCustody.hint")}</p>
          <label>
            {t("inventoryCustody.condition")}
            <select
              aria-label={t("inventoryCustody.condition")}
              disabled={busy || !!attempt}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {["new", "good", "fair", "damaged", "missing", "stolen"].map(
                (c) => (
                  <option key={c} value={c}>
                    {t(`inventoryCustody.conditions.${c}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          {action === "checkout" && (
            <label>
              {t("inventoryCustody.date")}
              <input
                type="datetime-local"
                value={date}
                disabled={busy || !!attempt}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          <label>
            {t("inventoryCustody.photo")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || !!attempt}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addPhoto(f);
              }}
            />
          </label>
          <p>{t("inventoryCustody.photoCount", { count: photos.length })}</p>
          {attempt ? (
            <>
              <p>
                {t("inventoryCustody.reviewed", {
                  condition: t(
                    "inventoryCustody.conditions." + attempt.input.condition,
                  ),
                  date:
                    attempt.input.expectedReturnAt ??
                    t("inventoryCustody.noDate"),
                })}
              </p>
              <PngPillButton color="blue" disabled={busy} onClick={send}>
                {t(
                  unknown
                    ? "inventoryCustody.retry"
                    : "inventoryCustody.confirm",
                )}
              </PngPillButton>
              {unknown && <p role="status">{t("inventoryCustody.unknown")}</p>}
            </>
          ) : (
            <PngPillButton color="blue" disabled={busy} onClick={review}>
              {t("inventoryCustody.review")}
            </PngPillButton>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
