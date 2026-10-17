import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetRunOrderHistorySchema,
  fleetRunOrderRoute,
  type FleetRunOrder,
  type FleetRoutePlan,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { FleetRunOrderChoice } from "./fleet-run-order-choice";
import { FleetSaveRunOrder } from "./fleet-save-run-order";
import { FleetRouteFields } from "./fleet-route-fields";
import { PngPillButton } from "./png-pill-rollover";

export function FleetRunOrders({
  identity,
  companyId,
  groups,
}: {
  identity: string;
  companyId: number;
  groups: { id: string; name: string }[];
}) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    cache = useQueryClient(),
    alive = useRef(true),
    generation = useRef(0);
  const [group, setGroup] = useState(groups[0]?.id ?? ""),
    [selected, setSelected] = useState<FleetRunOrder | null>(null),
    [editing, setEditing] = useState(false),
    [route, setRoute] = useState<FleetRoutePlan | null>(null),
    [zone, setZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [pending, setPending] = useState(false),
    [canManage, setCanManage] = useState(false),
    [refresh, setRefresh] = useState(0),
    [history, setHistory] = useState<z.infer<
      typeof FleetRunOrderHistorySchema
    > | null>(null),
    [loadingHistory, setLoadingHistory] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [identity, companyId]);
  const directory = useQuery({
    queryKey: ["fleet-order-locations", identity],
    queryFn: () => fleetClient.commercial(),
    retry: false,
  });
  function choose(order: FleetRunOrder | null) {
    generation.current++;
    setSelected(order);
    setEditing(false);
    setRoute(null);
    setHistory(null);
    setLoadingHistory(false);
    setError("");
    setZone(
      order?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  }
  function edit() {
    if (!selected || !canManage || pending) return;
    setRoute(fleetRunOrderRoute(selected, () => crypto.randomUUID()));
    setZone(selected.timeZone);
    setEditing(true);
    setHistory(null);
  }
  async function loadHistory(more = false) {
    if (!selected || loadingHistory) return;
    const request = generation.current;
    setLoadingHistory(true);
    setError("");
    try {
      const page = FleetRunOrderHistorySchema.parse(
        await fleetClient.runOrderHistory(
          selected.id,
          more ? (history?.nextCursor ?? undefined) : undefined,
        ),
      );
      if (!alive.current || request !== generation.current) return;
      if (
        page.records.some(
          (row) =>
            row.order.companyId !== companyId || row.order.id !== selected.id,
        )
      )
        throw new Error("Run history changed scope.");
      setHistory((previous) =>
        more && previous
          ? { ...page, records: [...previous.records, ...page.records] }
          : page,
      );
    } catch {
      if (alive.current && request === generation.current)
        setError(
          es
            ? "Historial no disponible. Actualice para comprobar el acceso."
            : "Run history unavailable. Reload to check access.",
        );
    } finally {
      if (alive.current && request === generation.current)
        setLoadingHistory(false);
    }
  }
  const places = [
    ...new Map(
      [
        ...(selected
          ? [
              selected.origin,
              selected.destination,
              ...(selected.base ? [selected.base] : []),
            ]
          : []),
        ...(directory.data?.destinations ?? []),
      ].map((place) => [place.id, place]),
    ).values(),
  ];
  return (
    <section
      className="space-y-3 rounded-xl border-2 p-4"
      aria-label={es ? "Recorridos guardados" : "Saved Runs"}
    >
      <h2>{es ? "Recorridos guardados" : "Saved Runs"}</h2>
      {groups.length > 1 && (
        <label>
          {es ? "Recursos de la empresa" : "Company resources"}
          <select
            value={group}
            disabled={pending}
            onChange={(event) => {
              setGroup(event.target.value);
              choose(null);
              setRefresh((value) => value + 1);
            }}
          >
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!group ? (
        <p>
          {es
            ? "Configure el acceso a los recursos de la empresa para preparar recorridos."
            : "Set up company resource access to prepare Runs."}
        </p>
      ) : (
        <>
          <FleetRunOrderChoice
            key={`${identity}:${group}:${refresh}`}
            identity={identity}
            companyId={companyId}
            groupId={group}
            disabled={pending || editing}
            onCanManage={setCanManage}
            onChange={choose}
          />
          {canManage && (
            <PngPillButton
              disabled={pending}
              onClick={() => {
                setSelected(null);
                setRoute(null);
                setEditing(true);
                setHistory(null);
              }}
            >
              {es ? "Nuevo recorrido guardado" : "New saved Run"}
            </PngPillButton>
          )}
          {selected && !editing && (
            <div className="flex flex-wrap gap-3">
              {canManage && (
                <PngPillButton disabled={pending} onClick={edit}>
                  {es ? "Editar recorrido seleccionado" : "Edit selected Run"}
                </PngPillButton>
              )}
              <PngPillButton
                disabled={pending || loadingHistory}
                onClick={() => void loadHistory()}
              >
                {es ? "Historial de versiones" : "Run revision history"}
              </PngPillButton>
            </div>
          )}
          {editing && (
            <div className="space-y-3 rounded-xl border-2 p-3">
              <p>
                {es
                  ? "Los cambios se aplican a futuros despachos. Las actividades anteriores conservan su versión guardada."
                  : "Changes apply to future dispatch. Existing activities keep their saved Run revision."}
              </p>
              <fieldset disabled={pending}>
                <FleetRouteFields
                  key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                  value={route}
                  destinations={places}
                  onChange={setRoute}
                />
              </fieldset>
              <label>
                {es ? "Zona horaria del recorrido" : "Run time zone"}
                <select
                  value={zone}
                  disabled={pending}
                  onChange={(event) => setZone(event.target.value)}
                >
                  {[
                    ...new Set([
                      zone,
                      "America/Chicago",
                      "America/Denver",
                      "UTC",
                    ]),
                  ].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              {route && (
                <FleetSaveRunOrder
                  key={`${identity}:${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                  identity={identity}
                  companyId={companyId}
                  groupId={group}
                  initialOrder={selected ?? undefined}
                  route={route}
                  timeZone={zone}
                  disabled={!canManage}
                  onPending={setPending}
                  onSaved={() => {
                    setEditing(false);
                    choose(null);
                    setRefresh((value) => value + 1);
                    void cache.invalidateQueries({
                      queryKey: ["fleet-run-orders", identity],
                    });
                  }}
                />
              )}
              <PngPillButton
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setRoute(null);
                }}
              >
                {es ? "Cerrar editor" : "Close Run editor"}
              </PngPillButton>
            </div>
          )}
          {history && (
            <div className="space-y-2">
              <h3>{es ? "Historial de versiones" : "Run revision history"}</h3>
              {history.records.map((row) => (
                <article key={row.id} className="rounded border-2 p-3">
                  <p>
                    {es ? "Versión" : "Revision"} {row.order.version} ·{" "}
                    {row.order.name}
                  </p>
                  <p>
                    {row.order.origin.name} → {row.order.destination.name}
                  </p>
                  <p>{row.order.instructions}</p>
                </article>
              ))}
              {history.nextCursor && (
                <PngPillButton
                  disabled={loadingHistory || pending}
                  onClick={() => void loadHistory(true)}
                >
                  {es ? "Cargar más versiones" : "Load more revisions"}
                </PngPillButton>
              )}
            </div>
          )}
        </>
      )}
      {!!error && <p role="alert">{error}</p>}
      <PngPillButton
        disabled={pending}
        onClick={() => {
          choose(null);
          setCanManage(false);
          setRefresh((value) => value + 1);
          void cache.invalidateQueries({
            queryKey: ["fleet-run-orders", identity],
          });
          void directory.refetch();
        }}
      >
        {es ? "Recargar biblioteca de recorridos" : "Reload Run library"}
      </PngPillButton>
    </section>
  );
}
