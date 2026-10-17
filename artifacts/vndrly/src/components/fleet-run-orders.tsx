import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetRunOrderHistorySchema,
  FleetRunOrderLocationsSchema,
  fleetRunOrderWithReviewedLocations,
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
    [loadingLocations, setLoadingLocations] = useState(false),
    [locationReview, setLocationReview] = useState<z.infer<
      typeof FleetRunOrderLocationsSchema
    > | null>(null),
    [reviewedPlaces, setReviewedPlaces] = useState<
      z.infer<typeof FleetRunOrderLocationsSchema>["locations"]
    >([]),
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
    setLocationReview(null);
    setLoadingLocations(false);
    setReviewedPlaces([]);
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
  async function reviewLocations() {
    if (!selected || pending || loadingLocations) return;
    const request = generation.current;
    setLoadingLocations(true);
    setLocationReview(null);
    setError("");
    try {
      const review = FleetRunOrderLocationsSchema.parse(
        await fleetClient.runOrderLocations(selected.id),
      );
      if (!alive.current || request !== generation.current) return;
      if (
        review.orderId !== selected.id ||
        review.orderVersion !== selected.version
      )
        throw new Error("Run changed.");
      setLocationReview(review);
    } catch {
      if (alive.current && request === generation.current)
        setError(
          es
            ? "No se pueden revisar las ubicaciones. Recargue el recorrido."
            : "Locations cannot be reviewed. Reload the Run.",
        );
    } finally {
      if (alive.current && request === generation.current)
        setLoadingLocations(false);
    }
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
        ...reviewedPlaces,
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
                choose(null);
                setEditing(true);
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
              {selected && (
                <PngPillButton
                  disabled={pending || loadingLocations}
                  onClick={() => void reviewLocations()}
                >
                  {es
                    ? "Revisar ubicaciones actuales"
                    : "Review current locations"}
                </PngPillButton>
              )}
              {locationReview && (
                <div
                  role="region"
                  aria-label={
                    es ? "Revisión de ubicaciones" : "Location review"
                  }
                  className="rounded-xl border-2 p-3 space-y-2"
                >
                  <p>
                    {es
                      ? "Aplicar las ubicaciones actuales de este recorrido al borrador. Los viajes anteriores conservan sus ubicaciones."
                      : "Apply this Run's current locations to the draft. Previous activities retain their locations."}
                  </p>
                  {locationReview.locations.map((place) => (
                    <p key={place.id}>
                      {place.name} · {place.address} ·{" "}
                      {es ? "Versión" : "Revision"} {place.revision}
                    </p>
                  ))}
                  {!!locationReview.unavailableLocationIds.length && (
                    <p role="alert">
                      {es
                        ? "Una ubicación ya no está disponible. Elija una ruta autorizada antes de guardar."
                        : "A location is no longer available. Choose an authorized route before saving."}
                    </p>
                  )}
                  <PngPillButton
                    disabled={
                      pending || !!locationReview.unavailableLocationIds.length
                    }
                    onClick={() => {
                      if (!selected) return;
                      try {
                        setRoute(
                          fleetRunOrderRoute(
                            fleetRunOrderWithReviewedLocations(
                              selected,
                              locationReview,
                            ),
                            () => crypto.randomUUID(),
                          ),
                        );
                        setReviewedPlaces(locationReview.locations);
                        setLocationReview(null);
                      } catch {
                        setError(
                          es
                            ? "Recargue el recorrido y revise las ubicaciones."
                            : "Reload the Run and review its locations.",
                        );
                      }
                    }}
                  >
                    {es
                      ? "Usar ubicaciones revisadas"
                      : "Use reviewed locations"}
                  </PngPillButton>
                  <PngPillButton
                    disabled={pending}
                    onClick={() => setLocationReview(null)}
                  >
                    {es ? "Cerrar revisión" : "Dismiss location review"}
                  </PngPillButton>
                </div>
              )}
              <fieldset
                disabled={pending || loadingLocations || !!locationReview}
              >
                <FleetRouteFields
                  key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                  value={route}
                  destinations={[
                    ...new Map(
                      [...places, ...(locationReview?.locations ?? [])].map(
                        (place) => [place.id, place],
                      ),
                    ).values(),
                  ]}
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
                  disabled={!canManage || loadingLocations || !!locationReview}
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
                  generation.current++;
                  setLoadingLocations(false);
                  setLocationReview(null);
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
