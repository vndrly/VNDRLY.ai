import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  mayTransferHandoff,
  type ChangeOverState,
  type ChangeOverSnapshot,
  type IncomingHandoffAuth,
  type ShiftNotesResponse,
} from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import BrandPillButton from "@/components/brand-pill-button";
import { Card, CardContent } from "@/components/ui/card";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { changeOverRequest as request } from "@/lib/change-over-api";

export function ShiftSnapshotView({
  snapshot,
}: {
  snapshot: ChangeOverSnapshot;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("changeOver.asOf")} {new Date(snapshot.generatedAt).toLocaleString()}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Object.entries(snapshot.metrics).map(([key, value]) => (
          <div className="rounded-lg border p-3" key={key}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm">{t(`changeOver.${key}`)}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("changeOver.coverage")}
      </p>
      <h3 className="font-bold">{t("changeOver.outstanding")}</h3>
      {snapshot.outstanding.length === 0 ? (
        <p>{t("changeOver.none")}</p>
      ) : (
        <ul className="space-y-2">
          {snapshot.outstanding.map((row) => (
            <li key={row.id} className="rounded border p-2">
              <strong>{row.name || row.id}</strong> · {row.company} ·{" "}
              {row.plate}
              <br />
              <span className="text-sm">
                {row.id} · {new Date(row.checkIn).toLocaleString()}
              </span>
              {row.notes && <p className="whitespace-pre-wrap">{row.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-bold">{t("changeOver.exceptions")}</h3>
      {snapshot.exceptions.length === 0 ? (
        <p>{t("changeOver.none")}</p>
      ) : (
        <ul>
          {snapshot.exceptions.map((e) => (
            <li key={`${e.sourceId}:${e.code}`}>{e.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GateChangeOverPage({
  history = false,
}: {
  history?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [selectedSite, setSelectedSite] = useState(
    () => new URLSearchParams(window.location.search).get("siteId") ?? "",
  );
  const [selectedStation, setSelectedStation] = useState(
    () => new URLSearchParams(window.location.search).get("stationId") ?? "",
  );
  const [notes, setNotes] = useState("");
  const [itemText, setItemText] = useState("");
  const [reason, setReason] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState<IncomingHandoffAuth | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(7);
  const [before, setBefore] = useState("");
  const [stationName, setStationName] = useState("");
  const sites = useQuery({
    queryKey: ["change-over-sites", user?.userId],
    queryFn: () =>
      request<{ sites: { id: number; name: string; supervisor: boolean }[] }>(
        "/sites",
      ),
    retry: false,
  });
  const siteId = selectedSite || String(sites.data?.sites[0]?.id ?? "");
  const stations = useQuery({
    queryKey: ["change-over-stations", user?.userId, siteId],
    queryFn: () =>
      request<{ stations: { id: string; name: string }[] }>(
        `/stations?siteId=${siteId}`,
      ),
    enabled: Boolean(siteId),
    retry: false,
  });
  const stationId = selectedStation || stations.data?.stations[0]?.id || "";
  const state = useQuery({
    queryKey: ["change-over-state", user?.userId, stationId],
    queryFn: () => request<ChangeOverState>(`/${stationId}/state`),
    enabled: Boolean(stationId) && !history,
    retry: false,
    refetchInterval: 15000,
    networkMode: "always",
  });
  const log = useQuery({
    queryKey: ["shift-notes", user?.userId, stationId, search, days, before],
    queryFn: () =>
      request<ShiftNotesResponse>(
        `/${stationId}/notes?${new URLSearchParams({ days: String(days), search, ...(before ? { before } : {}) })}`,
      ),
    enabled: Boolean(stationId) && history,
    retry: false,
    networkMode: "always",
  });
  const current = state.data;
  const prep = current?.preparation;
  const revision = current?.snapshot?.revision ?? "";
  const ownShift = current?.shift?.operator_id === user?.userId;
  const resetReview = () => {
    setAuth(null);
    setAcknowledged(false);
    setReviewedRevision("");
    setPassword("");
  };
  useEffect(() => {
    resetReview();
    setNotes("");
    setError("");
    setBefore("");
  }, [stationId, user?.userId]);
  useEffect(() => {
    resetReview();
  }, [revision, prep?.id, current?.stale]);
  useEffect(() => {
    if (prep) setNotes(prep.notes);
  }, [prep?.id]);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      resetReview();
      if (navigator.onLine)
        void cache.invalidateQueries({ queryKey: ["change-over-state"] });
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [cache]);
  const act = async (work: () => Promise<void>) => {
    if (!online || busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? "code" in e && typeof e.code === "string"
            ? t(`errors.${e.code}`, { defaultValue: e.message })
            : e.message
          : t("changeOver.failed"),
      );
      resetReview();
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, body: unknown) => {
    await request(`/${stationId}/${path}`, body);
    resetReview();
    await state.refetch();
  };
  const canTransfer = mayTransferHandoff({
    online: online && !state.isError,
    acknowledged,
    proof: auth?.proof ?? "",
    reviewedRevision,
    currentRevision: revision,
    stale: current?.stale ?? true,
  });
  const loading =
    sites.isLoading ||
    stations.isLoading ||
    (history ? log.isLoading : state.isLoading);
  const loadError =
    sites.error || stations.error || (history ? log.error : state.error);
  return (
    <div className={`${FIELD_OPS_PAGE_CLASS} space-y-5`}>
      <h1 className="text-2xl font-bold">
        {t(history ? "changeOver.shiftNotes" : "changeOver.title")}
      </h1>
      <p>{t(history ? "changeOver.historyIntro" : "changeOver.intro")}</p>
      <div className="flex flex-wrap gap-3">
        <label>
          {t("changeOver.site")}
          <select
            aria-label={t("changeOver.site")}
            className="ml-2 rounded border bg-background p-2"
            value={siteId}
            onChange={(e) => {
              setSelectedSite(e.target.value);
              setSelectedStation("");
            }}
          >
            <option value="">{t("changeOver.choose")}</option>
            {sites.data?.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("changeOver.gate")}
          <select
            aria-label={t("changeOver.gate")}
            className="ml-2 rounded border bg-background p-2"
            value={stationId}
            onChange={(e) => setSelectedStation(e.target.value)}
          >
            <option value="">{t("changeOver.choose")}</option>
            {stations.data?.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!online && <p role="status">{t("changeOver.offline")}</p>}
      {loading && <p role="status">{t("changeOver.loading")}</p>}
      {(error || loadError) && (
        <p role="alert" className="text-destructive">
          {error || (loadError as Error).message}
        </p>
      )}
      {!loading && sites.data?.sites.length === 0 && (
        <p>{t("changeOver.noSites")}</p>
      )}
      {history ? (
        <>
          <div className="flex gap-3">
            <input
              aria-label={t("changeOver.search")}
              placeholder={t("changeOver.search")}
              className="rounded border bg-background p-2"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setBefore("");
              }}
            />
            <select
              aria-label={t("changeOver.range")}
              className="rounded border bg-background p-2"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setBefore("");
              }}
            >
              {[7, 30, 90, 365, 3650].map((n) => (
                <option key={n} value={n}>
                  {n} {t("changeOver.days")}
                </option>
              ))}
            </select>
          </div>
          {log.data?.rows.length === 0 && <p>{t("changeOver.noNotes")}</p>}
          {log.data?.rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-4 p-5">
                <h2 className="font-bold">
                  {new Date(row.acknowledged_at).toLocaleString()} ·{" "}
                  {row.outgoing_name} → {row.incoming_name}
                </h2>
                <p>{t("changeOver.acknowledged")}</p>
                <ul>
                  {row.summary.facts.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ul>
                <p className="whitespace-pre-wrap">{row.notes}</p>
                {row.snapshot.openItems.map((i) => (
                  <p key={i.id}>
                    {t("changeOver.carryForward")}: {i.text}
                  </p>
                ))}
                <details>
                  <summary>{t("changeOver.snapshot")}</summary>
                  <ShiftSnapshotView snapshot={row.snapshot} />
                </details>
              </CardContent>
            </Card>
          ))}
          {log.data?.nextBefore && (
            <BrandPillButton onClick={() => setBefore(log.data!.nextBefore!)}>
              {t("changeOver.older")}
            </BrandPillButton>
          )}
          {!!log.data?.actions.length && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <h2 className="font-bold">{t("changeOver.audit")}</h2>
                {log.data.actions.map((a) => (
                  <p key={a.id}>
                    {new Date(a.created_at).toLocaleString()} · {a.actor_name} ·{" "}
                    {a.kind}: {a.text}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        current && (
          <>
            <Card>
              <CardContent className="space-y-4 p-5">
                {current.shift ? (
                  <>
                    <h2 className="font-bold">
                      {current.shift.operator_name} ·{" "}
                      {new Date(current.shift.started_at).toLocaleString()}
                    </h2>
                    {current.snapshot && (
                      <ShiftSnapshotView snapshot={current.snapshot} />
                    )}
                  </>
                ) : (
                  <>
                    <p>{t("changeOver.noShift")}</p>
                    <BrandPillButton
                      disabled={busy || !online}
                      onClick={() => void act(() => mutate("start", {}))}
                    >
                      {t("changeOver.start")}
                    </BrandPillButton>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 p-5">
                <h2 className="font-bold">{t("changeOver.carryForward")}</h2>
                {current.items.map((i) => (
                  <div key={i.id} className="space-y-2 rounded border p-3">
                    <p className="whitespace-pre-wrap">{i.text}</p>
                    <p>{t(`changeOver.${i.status}`)}</p>
                    {(ownShift || current.supervisor) && (
                      <BrandPillButton
                        disabled={!online || busy || !reason.trim()}
                        onClick={() =>
                          void act(() =>
                            mutate("items", {
                              itemId: i.id,
                              kind: i.status === "open" ? "resolve" : "reopen",
                              text: reason,
                            }),
                          )
                        }
                      >
                        {t(
                          i.status === "open"
                            ? "changeOver.resolve"
                            : "changeOver.reopen",
                        )}
                      </BrandPillButton>
                    )}
                  </div>
                ))}
                {(ownShift || current.supervisor) && (
                  <>
                    <input
                      aria-label={t("changeOver.reason")}
                      placeholder={t("changeOver.reason")}
                      className="w-full rounded border bg-background p-2"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <textarea
                      aria-label={t("changeOver.newItem")}
                      placeholder={t("changeOver.newItem")}
                      className="w-full rounded border bg-background p-2"
                      maxLength={2000}
                      value={itemText}
                      onChange={(e) => setItemText(e.target.value)}
                    />
                    <BrandPillButton
                      disabled={busy || !online || !itemText.trim()}
                      onClick={() =>
                        void act(async () => {
                          await mutate("items", {
                            itemId: crypto.randomUUID(),
                            kind: "open",
                            text: itemText,
                          });
                          setItemText("");
                        })
                      }
                    >
                      {t("changeOver.addItem")}
                    </BrandPillButton>
                  </>
                )}
              </CardContent>
            </Card>
            {ownShift && (
              <Card>
                <CardContent className="space-y-4 p-5">
                  <label className="block font-bold">
                    {t("changeOver.outgoingNotes")}
                    <textarea
                      className="mt-2 min-h-28 w-full rounded border bg-background p-3 font-normal"
                      value={notes}
                      maxLength={8000}
                      onChange={(e) => {
                        setNotes(e.target.value);
                        resetReview();
                      }}
                    />
                  </label>
                  <BrandPillButton
                    disabled={busy || !online}
                    onClick={() => void act(() => mutate("prepare", { notes }))}
                  >
                    {t(
                      prep ? "changeOver.refreshHandoff" : "changeOver.prepare",
                    )}
                  </BrandPillButton>
                </CardContent>
              </Card>
            )}
            {prep && (
              <Card>
                <CardContent className="space-y-4 p-5">
                  <h2 className="font-bold">{t("changeOver.review")}</h2>
                  <p>
                    {t(
                      prep.summary.source === "ai_selected_facts"
                        ? "changeOver.aiFacts"
                        : "changeOver.factualSummary",
                    )}
                  </p>
                  <ul>
                    {prep.summary.facts.map((f) => (
                      <li key={f.id}>{f.text}</li>
                    ))}
                  </ul>
                  <p className="whitespace-pre-wrap">{prep.notes}</p>
                  {prep.snapshot.openItems.map((i) => (
                    <p key={i.id}>
                      {t("changeOver.carryForward")}: {i.text}
                    </p>
                  ))}
                  {current.stale && <p role="alert">{t("changeOver.stale")}</p>}
                  {ownShift && !current.stale && notes === prep.notes && (
                    <>
                      {!auth ? (
                        <form
                          className="space-y-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(async () => {
                              const result = await request<IncomingHandoffAuth>(
                                `/${stationId}/authenticate`,
                                {
                                  username,
                                  password,
                                  preparationId: prep.id,
                                  revision: prep.snapshot.revision,
                                },
                              );
                              setPassword("");
                              setAuth(result);
                              setReviewedRevision(prep.snapshot.revision);
                            });
                          }}
                        >
                          <h3 className="font-bold">
                            {t("changeOver.incomingLogin")}
                          </h3>
                          <input
                            aria-label={t("changeOver.username")}
                            autoComplete="off"
                            className="block w-full rounded border bg-background p-2"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder={t("changeOver.username")}
                          />
                          <input
                            aria-label={t("changeOver.password")}
                            autoComplete="new-password"
                            type="password"
                            className="block w-full rounded border bg-background p-2"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t("changeOver.password")}
                          />
                          <BrandPillButton
                            type="submit"
                            disabled={busy || !online || !username || !password}
                          >
                            {t("changeOver.authenticate")}
                          </BrandPillButton>
                        </form>
                      ) : (
                        <>
                          <p>
                            {t("changeOver.incoming")}:{" "}
                            <strong>{auth.incoming.displayName}</strong>
                          </p>
                          <label className="flex gap-2">
                            <input
                              type="checkbox"
                              checked={acknowledged}
                              onChange={(e) =>
                                setAcknowledged(e.target.checked)
                              }
                            />
                            {t("changeOver.acknowledge")}
                          </label>
                          {acknowledged && (
                            <BrandPillButton
                              tone="brand"
                              disabled={busy || !canTransfer}
                              onClick={() =>
                                void act(async () => {
                                  await request(`/${stationId}/transfer`, {
                                    proof: auth.proof,
                                    acknowledged: true,
                                    operationId: crypto.randomUUID(),
                                  });
                                  await cache.cancelQueries();
                                  cache.clear();
                                  window.location.assign(
                                    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/gate/shift-notes?${new URLSearchParams({ siteId, stationId })}`,
                                  );
                                })
                              }
                            >
                              {t("changeOver.switchUser")}
                            </BrandPillButton>
                          )}
                        </>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {t("changeOver.recovery")}
                      </p>
                    </>
                  )}
                  {(ownShift || current.supervisor) && (
                    <BrandPillButton
                      disabled={busy || !online || !reason.trim()}
                      onClick={() =>
                        void act(() => mutate("cancel", { reason }))
                      }
                    >
                      {t("changeOver.cancel")}
                    </BrandPillButton>
                  )}
                </CardContent>
              </Card>
            )}
            {current.supervisor && (
              <Card>
                <CardContent className="space-y-3 p-5">
                  <h2 className="font-bold">{t("changeOver.supervisor")}</h2>
                  {current.shift && !ownShift && (
                    <>
                      <p>{t("changeOver.recoverExplanation")}</p>
                      <BrandPillButton
                        disabled={busy || !online || !reason.trim()}
                        onClick={() =>
                          void act(() =>
                            mutate("recover", {
                              expectedShiftId: current.shift!.id,
                              reason,
                              acknowledged: true,
                            }),
                          )
                        }
                      >
                        {t("changeOver.recover")}
                      </BrandPillButton>
                    </>
                  )}
                  <input
                    aria-label={t("changeOver.newGate")}
                    className="rounded border bg-background p-2"
                    placeholder={t("changeOver.newGate")}
                    value={stationName}
                    onChange={(e) => setStationName(e.target.value)}
                  />
                  <BrandPillButton
                    disabled={busy || !online || !stationName.trim()}
                    onClick={() =>
                      void act(async () => {
                        await request("/stations", {
                          siteId: Number(siteId),
                          name: stationName,
                        });
                        setStationName("");
                        await stations.refetch();
                      })
                    }
                  >
                    {t("changeOver.addGate")}
                  </BrandPillButton>
                </CardContent>
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}
export function GateShiftNotesPage() {
  return <GateChangeOverPage history />;
}
