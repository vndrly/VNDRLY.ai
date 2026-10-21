import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetCanonicalIdSchema,
  FleetDestinationDirectorySchema,
  FleetRunOrderHistorySchema,
  FleetRunOrderLocationsSchema,
  FleetRunOrderReceiptSchema,
  FleetRunOrderSaveSchema,
  FleetRunOrderSchema,
  fleetRunOrderWithReviewedLocations,
  fleetRunOrderRoute,
  type FleetRunOrder,
  type FleetRoutePlan,
  type FleetDestination,
  type FleetOverview,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import FleetRunOrderChoice from "./FleetRunOrderChoice";
import FleetSaveRunOrder from "./FleetSaveRunOrder";
import FleetRouteFields from "./FleetRouteFields";
import FleetChoiceField from "./FleetChoiceField";
import TogglePillButton from "./TogglePillButton";

export default function FleetRunOrders({ companyId, initialRunOrderId }: { companyId: number; initialRunOrderId?: string }) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    generation = useRef(0),
    contextGeneration = useRef(0);
  const [context, setContext] = useState<{
      groups: { id: string; name: string }[];
      places: FleetDestination[];
    } | null>(null),
    [contextRefresh, setContextRefresh] = useState(0),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState<FleetRunOrder | null>(null),
    [editing, setEditing] = useState(false),
    [confirmArchive, setConfirmArchive] = useState(false),
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
    [reviewedPlaces, setReviewedPlaces] = useState<FleetDestination[]>([]),
    [error, setError] = useState("");
  const archiveRequest = useRef<z.infer<typeof FleetRunOrderSaveSchema> | null>(null);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    alive.current = true;
    const request = ++contextGeneration.current;
    setError("");
    void Promise.all([
      apiFetch<FleetOverview>("/api/fleet/overview", {}, scope.current),
      apiFetch<unknown>("/api/fleet/commercial", {}, scope.current),
    ])
      .then(([overview, rawDirectory]) => {
        if (!current() || request !== contextGeneration.current) return;
        if (overview.companyId !== companyId || !overview.enabled)
          throw new Error("Company scope unavailable.");
        const directory = FleetDestinationDirectorySchema.parse(rawDirectory),
          groups = overview.fleets.map((item) => ({
            id: FleetCanonicalIdSchema.parse(item.id),
            name: item.name,
          }));
        if (groups.some((item) => typeof item.name !== "string"))
          throw new Error("Company resources unavailable.");
        setContext({ groups, places: directory.destinations });
        setGroup((previous) =>
          groups.some((item) => item.id === previous)
            ? previous
            : (groups[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (current() && request === contextGeneration.current) {
          setContext(null);
          setCanManage(false);
          setError(copy("Runs unavailable. Reload to check access."));
        }
      });
    return () => {
      alive.current = false;
      generation.current++;
      contextGeneration.current++;
    };
  }, [companyId, contextRefresh]);
  useEffect(() => {
    if (!initialRunOrderId) return;
    const request = ++generation.current;
    void apiFetch<unknown>(`/api/fleet/run-orders/${encodeURIComponent(initialRunOrderId)}`, {}, scope.current).then(raw => {
      const order = FleetRunOrderSchema.parse(raw);
      if (!current() || request !== generation.current || order.companyId !== companyId) return;
      setSelected(order); setEditing(false); setRoute(null); setHistory(null); setLocationReview(null); setZone(order.timeZone);
    }).catch(() => { if (current() && request === generation.current) setError(copy("Runs unavailable. Reload to check access.")); });
  }, [companyId, initialRunOrderId]);
  function choose(order: FleetRunOrder | null) {
    generation.current++;
    setSelected(order);
    setEditing(false);
    setConfirmArchive(false);
    archiveRequest.current = null;
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
  async function archiveSelected() {
    if (!selected || pending || !canManage || !current()) return;
    const body = archiveRequest.current ?? FleetRunOrderSaveSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: selected.version, order: { ...selected, version: selected.version + 1, archivedAt: new Date().toISOString() } });
    archiveRequest.current = body; setPending(true); setError("");
    try {
      await apiFetch("/api/fleet/run-orders", { method: "POST", body: JSON.stringify(body) }, scope.current);
      const receipt = FleetRunOrderReceiptSchema.parse(await apiFetch(`/api/fleet/run-orders/operations/${body.operationId}`, {}, scope.current));
      if (!current() || receipt.operationId !== body.operationId || receipt.order.id !== selected.id || !receipt.order.archivedAt) throw Error("Archive readback changed.");
      archiveRequest.current = null; choose(null); setRefresh(value => value + 1);
    } catch { if (current()) setError(copy("Run archive needs verification. Retry the same request.")); }
    finally { if (current()) setPending(false); }
  }
  async function loadHistory(more = false) {
    if (!selected || loadingHistory || !current()) return;
    const request = generation.current;
    setLoadingHistory(true);
    setError("");
    try {
      const after = more ? history?.nextCursor : null;
      const page = FleetRunOrderHistorySchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/run-orders/${selected.id}/history${after ? `?after=${after}` : ""}`,
          {},
          scope.current,
        ),
      );
      if (!current() || request !== generation.current) return;
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
      if (current() && request === generation.current)
        setError(copy("Run history unavailable. Reload to check access."));
    } finally {
      if (current() && request === generation.current) setLoadingHistory(false);
    }
  }
  async function reviewLocations() {
    if (!selected || pending || loadingLocations || !current()) return;
    const request = generation.current;
    setLoadingLocations(true);
    setLocationReview(null);
    setError("");
    try {
      const review = FleetRunOrderLocationsSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/run-orders/${selected.id}/locations`,
          {},
          scope.current,
        ),
      );
      if (!current() || request !== generation.current) return;
      if (
        review.orderId !== selected.id ||
        review.orderVersion !== selected.version
      )
        throw new Error("Run changed.");
      setLocationReview(review);
    } catch {
      if (current() && request === generation.current)
        setError(copy("Locations cannot be reviewed. Reload the Run."));
    } finally {
      if (current() && request === generation.current)
        setLoadingLocations(false);
    }
  }
  const text = { color: colors.text },
    card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      backgroundColor: colors.card,
    };
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
        ...(context?.places ?? []),
        ...reviewedPlaces,
      ].map((place) => [place.id, place]),
    ).values(),
  ];
  return (
    <View style={card}>
      <Text style={[text, { fontSize: 20, fontWeight: "700" }]}>
        {copy("Saved Runs")}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      {context ? (
        <>
          {context.groups.length > 1 && (
            <FleetChoiceField
              label={copy("Company resources")}
              value={group}
              options={context.groups.map((item) => ({
                id: item.id,
                label: item.name,
              }))}
              disabled={pending}
              onChange={(id) => {
                setGroup(id);
                choose(null);
                setRefresh((value) => value + 1);
              }}
            />
          )}
          {!group ? (
            <Text style={text}>
              {copy("Set up company resource access to prepare Runs.")}
            </Text>
          ) : (
            <>
              <FleetRunOrderChoice
                key={`${companyId}:${group}:${refresh}`}
                companyId={companyId}
                groupId={group}
                disabled={pending || editing}
                onCanManage={setCanManage}
                onChange={choose}
              />
              {canManage && (
                <TogglePillButton
                  disabled={pending}
                  onPress={() => {
                    choose(null);
                    setEditing(true);
                  }}
                >
                  {copy("New saved Run")}
                </TogglePillButton>
              )}
              {selected && !editing && (
                <View style={{ gap: 8 }}>
                  {canManage && (
                    <><TogglePillButton disabled={pending} onPress={() => { setRoute(fleetRunOrderRoute(selected, Crypto.randomUUID)); setZone(selected.timeZone); setEditing(true); setHistory(null); }}>{copy("Edit selected Run")}</TogglePillButton>
                    {!confirmArchive ? <TogglePillButton color="red" disabled={pending} onPress={() => setConfirmArchive(true)}>{copy("Archive selected Run")}</TogglePillButton> : <View style={{ gap: 6 }}><Text style={{ color: colors.destructive }}>{copy("Archive this saved Run? Existing tickets and completed activity stay unchanged.")}</Text><TogglePillButton color="red" disabled={pending} onPress={() => void archiveSelected()}>{copy(archiveRequest.current ? "Verify and retry Run archive" : "Confirm archive")}</TogglePillButton><TogglePillButton disabled={pending} onPress={() => setConfirmArchive(false)}>{copy("Keep Run")}</TogglePillButton></View>}</>
                  )}
                  <TogglePillButton
                    disabled={pending || loadingHistory}
                    onPress={() => void loadHistory()}
                  >
                    {copy("Run revision history")}
                  </TogglePillButton>
                </View>
              )}
              {editing && (
                <View style={card}>
                  <Text style={text}>
                    {copy(
                      "Changes apply to future dispatch. Existing activities keep their saved Run revision.",
                    )}
                  </Text>
                  {selected && (
                    <TogglePillButton
                      disabled={pending || loadingLocations}
                      onPress={() => void reviewLocations()}
                    >
                      {copy("Review current locations")}
                    </TogglePillButton>
                  )}
                  {locationReview && (
                    <View style={card}>
                      <Text style={text}>
                        {copy(
                          "Apply this Run's current locations to the draft. Previous activities retain their locations.",
                        )}
                      </Text>
                      {locationReview.locations.map((place) => (
                        <Text key={place.id} style={text}>
                          {place.name} · {place.address} · {copy("Revision")}{" "}
                          {place.revision}
                        </Text>
                      ))}
                      {!!locationReview.unavailableLocationIds.length && (
                        <Text
                          accessibilityRole="alert"
                          style={{ color: colors.destructive }}
                        >
                          {copy(
                            "A location is no longer available. Choose an authorized route before saving.",
                          )}
                        </Text>
                      )}
                      <TogglePillButton
                        disabled={
                          pending ||
                          !!locationReview.unavailableLocationIds.length
                        }
                        onPress={() => {
                          if (!selected) return;
                          try {
                            setRoute(
                              fleetRunOrderRoute(
                                fleetRunOrderWithReviewedLocations(
                                  selected,
                                  locationReview,
                                ),
                                Crypto.randomUUID,
                              ),
                            );
                            setReviewedPlaces(locationReview.locations);
                            setLocationReview(null);
                          } catch {
                            setError(
                              copy("Reload the Run and review its locations."),
                            );
                          }
                        }}
                      >
                        {copy("Use reviewed locations")}
                      </TogglePillButton>
                      <TogglePillButton
                        disabled={pending}
                        onPress={() => setLocationReview(null)}
                      >
                        {copy("Dismiss location review")}
                      </TogglePillButton>
                    </View>
                  )}
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
                    disabled={
                      pending ||
                      !canManage ||
                      loadingLocations ||
                      !!locationReview
                    }
                    onChange={setRoute}
                  />
                  <FleetChoiceField
                    label={copy("Run time zone")}
                    value={zone}
                    options={[
                      ...new Set([
                        zone,
                        "America/Chicago",
                        "America/Denver",
                        "UTC",
                      ]),
                    ].map((value) => ({ id: value, label: value }))}
                    disabled={pending || !canManage}
                    onChange={setZone}
                  />
                  {route && (
                    <FleetSaveRunOrder
                      key={`${companyId}:${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                      companyId={companyId}
                      groupId={group}
                      initialOrder={selected ?? undefined}
                      route={route}
                      timeZone={zone}
                      disabled={
                        !canManage || loadingLocations || !!locationReview
                      }
                      onPending={setPending}
                      onSaved={() => {
                        setEditing(false);
                        choose(null);
                        setRefresh((value) => value + 1);
                      }}
                    />
                  )}
                  <TogglePillButton
                    disabled={pending}
                    onPress={() => {
                      setEditing(false);
                      setRoute(null);
                      generation.current++;
                      setLoadingLocations(false);
                      setLocationReview(null);
                    }}
                  >
                    {copy("Close Run editor")}
                  </TogglePillButton>
                </View>
              )}
              {history && (
                <View style={{ gap: 8 }}>
                  <Text style={text}>{copy("Run revision history")}</Text>
                  {history.records.map((row) => (
                    <View key={row.id} style={card}>
                      <Text style={text}>
                        {copy("Revision")} {row.order.version} ·{" "}
                        {row.order.name}
                      </Text>
                      <Text style={text}>
                        {row.order.origin.name} → {row.order.destination.name}
                      </Text>
                      <Text style={text}>{row.order.instructions}</Text>
                    </View>
                  ))}
                  {history.nextCursor && (
                    <TogglePillButton
                      disabled={pending || loadingHistory}
                      onPress={() => void loadHistory(true)}
                    >
                      {copy("Load more revisions")}
                    </TogglePillButton>
                  )}
                </View>
              )}
            </>
          )}
        </>
      ) : (
        !error && <Text style={text}>{copy("Loading saved Runs…")}</Text>
      )}
      <TogglePillButton
        disabled={pending}
        onPress={() => {
          choose(null);
          setCanManage(false);
          setRefresh((value) => value + 1);
          setContextRefresh((value) => value + 1);
        }}
      >
        {copy("Reload Run library")}
      </TogglePillButton>
    </View>
  );
}
