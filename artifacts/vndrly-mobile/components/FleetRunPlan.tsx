import React, { useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { Text, View } from "react-native";
import {
  CreateFleetRunSchema,
  FleetDetailPageSchema,
  FleetDetailSnapshotSchema,
  FleetDestinationDirectorySchema,
  FleetTimeZoneSchema,
  fleetRouteOperationalStops,
  type FleetDetailSnapshot,
  type FleetDetailPage,
  type FleetRoutePlan,
  type FleetDestination,
  type FleetRunBillingInputSchema,
  type FleetWorkSession,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import FleetChoiceField from "./FleetChoiceField";
import FleetRouteFields from "./FleetRouteFields";
import TogglePillButton from "./TogglePillButton";
import FleetRunOrderChoice from "./FleetRunOrderChoice";
import FleetSaveRunOrder from "./FleetSaveRunOrder";
import {
  fleetRunOrderRoute,
  fleetRouteMatchesRunOrder,
  type FleetRunOrder,
} from "@workspace/api-zod";
export type FleetRunPlan = {
  detail: FleetDetailSnapshot;
  route: FleetRoutePlan;
  billingSiteId: number;
  timeZone: string;
  runOrder?: FleetRunOrder;
};
export function createFleetRunFromPlan(input: {
  operationId: string;
  originStopId: string;
  fleetId: string;
  title: string;
  plan: FleetRunPlan;
  billing: z.infer<typeof FleetRunBillingInputSchema>;
}) {
  const { detail, route, billingSiteId, timeZone } = input.plan;
  if (!detail.detail.accessGroupIds.includes(input.fleetId))
    throw new Error("Detail is not available in this access group.");
  const order = input.plan.runOrder;
  if (
    order &&
    (order.companyId !== detail.detail.companyId ||
      !order.accessGroupIds.includes(input.fleetId) ||
      !fleetRouteMatchesRunOrder(route, order))
  )
    throw new Error("Saved Run and physical route no longer match.");
  return CreateFleetRunSchema.parse({
    operationId: input.operationId,
    fleetId: input.fleetId,
    title: input.title,
    driverUserId: detail.detail.driverUserId,
    vehicleAssetId: detail.detail.vehicleAssetId,
    trailerAssetId:
      detail.rigPackage?.components.find((row) => row.role === "trailer")
        ?.assetId ?? null,
    billing: input.billing,
    ...(order
      ? { runOrderSelection: { id: order.id, version: order.version } }
      : {}),
    detailSelection: {
      version: 2,
      detailId: detail.detail.id,
      detailVersion: detail.detail.version,
      timeZone,
      returnPolicy: route.returnPolicy,
    },
    routePlan: route,
    stops: fleetRouteOperationalStops(route, billingSiteId, input.originStopId),
  });
}
export default function FleetRunPlan({
  groupId,
  companyId,
  siteIds,
  disabled,
  onChange,
  workSession,
}: {
  workSession?:FleetWorkSession|null;
  groupId: string;
  companyId: number;
  siteIds: readonly number[];
  disabled: boolean;
  onChange: (value: FleetRunPlan | null) => void;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    generation = useRef(0),
    detailRequest = useRef(0),
    zoneChosen = useRef(false);
  const [useOrder, setUseOrder] = useState(false),
    [runOrder, setRunOrder] = useState<FleetRunOrder | null>(null);
  const [orderPending, setOrderPending] = useState(false);
  const [details, setDetails] = useState<FleetDetailPage | null>(null),
    [places, setPlaces] = useState<FleetDestination[]>([]),
    [sites, setSites] = useState<{ siteId: number; name: string }[]>([]),
    [selected, setSelected] = useState(""),
    [snapshot, setSnapshot] = useState<FleetDetailSnapshot | null>(null),
    [billingSite, setBillingSite] = useState(""),
    [route, setRoute] = useState<FleetRoutePlan | null>(null),
    [timeZone, setTimeZone] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setRunOrder(null);
  }, [groupId, companyId, refresh]);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    alive.current = true;
    const request = ++generation.current;
    setDetails(null);
    setSnapshot(null);
    setSelected("");
    setBillingSite("");
    setRoute(null);
    setLoading(true);
    setError("");
    void Promise.all([
      workSession?workSession.detailChoices():apiFetch<unknown>("/api/fleet/details", {}, scope.current),
      workSession?workSession.directory():apiFetch<unknown>("/api/fleet/commercial", {}, scope.current),
    ])
      .then(([rawDetails, rawDirectory]) => {
        if (!current() || request !== generation.current) return;
        const list = FleetDetailPageSchema.parse(rawDetails),
          directory = FleetDestinationDirectorySchema.parse(rawDirectory);
        if (list.details.some((row) => row.companyId !== companyId))
          throw new Error("Company scope changed.");
        setDetails(list);
        setPlaces(directory.destinations);
        setSites(directory.sites);
      })
      .catch(() => {
        if (current() && request === generation.current)
          setError(copy("Details or locations unavailable. Try again."));
      })
      .finally(() => {
        if (current() && request === generation.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      generation.current++;
      detailRequest.current++;
    };
  }, [groupId, companyId, refresh]);
  useEffect(() => {
    const zone =
      route?.origin.type === "canonical"
        ? route.origin.location.timeZone
        : null;
    if (zone && !zoneChosen.current) setTimeZone(zone);
  }, [route?.origin]);
  useEffect(() => {
    const validZone = FleetTimeZoneSchema.safeParse(timeZone);
    const site = Number(billingSite);
    onChange(
      current() &&
        !orderPending &&
        snapshot &&
        route &&
        (!useOrder || runOrder) &&
        validZone.success &&
        siteIds.includes(site) &&
        sites.some((row) => row.siteId === site)
        ? {
            detail: snapshot,
            route,
            billingSiteId: site,
            timeZone: validZone.data,
            ...(runOrder ? { runOrder } : {}),
          }
        : null,
    );
  }, [
    snapshot,
    route,
    billingSite,
    timeZone,
    sites,
    siteIds,
    onChange,
    runOrder,
    useOrder,
    orderPending,
  ]);
  async function choose(id: string) {
    setSelected(id);
    setSnapshot(null);
    setError("");
    const request = ++detailRequest.current;
    const expected = details?.details.find((row) => row.id === id);
    if (!expected) return;
    try {
      const value = FleetDetailSnapshotSchema.parse(
        workSession?await workSession.recoveryDetail(id):await apiFetch<unknown>(`/api/fleet/details/${id}`, {}, scope.current),
      );
      if (!current() || request !== detailRequest.current) return;
      if (
        value.detail.companyId !== companyId ||
        value.detail.id !== id ||
        value.detail.version !== expected.version ||
        !value.detail.accessGroupIds.includes(groupId)
      )
        throw new Error("Detail changed.");
      setSnapshot(value);
    } catch {
      if (current() && request === detailRequest.current)
        setError(copy("Detail changed or is unavailable. Choose it again."));
    }
  }
  async function more() {
    const after = details?.nextCursor;
    if (!after || loading) return;
    setLoading(true);
    const request = generation.current;
    try {
      const page = FleetDetailPageSchema.parse(
        workSession?await workSession.detailChoices(after):await apiFetch<unknown>(
          `/api/fleet/details?after=${encodeURIComponent(after)}`,
          {},
          scope.current,
        ),
      );
      if (current() && request === generation.current) {
        if (page.details.some((row) => row.companyId !== companyId))
          throw new Error("Company scope changed.");
        setDetails((previous) =>
          previous
            ? {
                ...page,
                details: [
                  ...new Map(
                    [...previous.details, ...page.details].map((row) => [
                      row.id,
                      row,
                    ]),
                  ).values(),
                ],
              }
            : page,
        );
      }
    } catch {
      if (current())
        setError(copy("Details or locations unavailable. Try again."));
    } finally {
      if (current()) setLoading(false);
    }
  }
  useEffect(()=>{if(workSession&&snapshot&&Number(billingSite)>0)void workSession.prepareSelection(snapshot.detail.id,Number(billingSite),null).catch(()=>undefined);},[workSession,snapshot,billingSite]);
  const now = Date.now(),
    options =
      details?.details
        .filter(
          (row) =>
            row.accessGroupIds.includes(groupId) &&
            !row.archivedAt &&
            Date.parse(row.effectiveFrom) <= now &&
            (!row.effectiveUntil || Date.parse(row.effectiveUntil) > now),
        )
        .map((row) => ({ id: row.id, label: row.name })) ?? [];
  const zones = [
    ...new Set(
      [
        timeZone,
        "America/Chicago",
        "America/Denver",
        "America/New_York",
        "America/Los_Angeles",
        "UTC",
      ].filter(Boolean),
    ),
  ];
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 16,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: "700" }}>
        {copy("Detail and physical route")}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      <FleetChoiceField
        label={copy("Saved Detail")}
        value={selected}
        options={options}
        disabled={disabled || loading}
        onChange={(id) => void choose(id)}
      />
      {details?.nextCursor && (
        <TogglePillButton
          disabled={disabled || loading}
          onPress={() => void more()}
        >
          {copy("Load more Details")}
        </TogglePillButton>
      )}
      {!loading && !options.length && (
        <Text style={{ color: colors.text }}>
          {copy("Create a Detail in Inventory and Details to use it here.")}
        </Text>
      )}
      {snapshot && (
        <Text style={{ color: colors.text }}>
          {snapshot.labels.truck} ·{" "}
          {snapshot.labels.rigPackage ?? copy("No rig package")} ·{" "}
          {snapshot.labels.driver}
        </Text>
      )}
      <FleetChoiceField
        label={copy("Billing site")}
        value={billingSite}
        options={sites
          .filter((row) => siteIds.includes(row.siteId))
          .map((row) => ({ id: String(row.siteId), label: row.name }))}
        disabled={disabled || loading}
        onChange={setBillingSite}
      />
      <Text style={{ color: colors.text }}>
        {copy("Billing site and AFE stay separate from the physical route.")}
      </Text>
      <TogglePillButton
        disabled={disabled || orderPending}
        onPress={() => {
          setUseOrder((value) => !value);
          setRoute(null);
          setRunOrder(null);
        }}
      >
        {copy(useOrder ? "Use a one-time physical route" : "Use saved Run")}
      </TogglePillButton>
      {useOrder ? (
        <FleetRunOrderChoice
          workSession={workSession}
          key={`${companyId}:${groupId}`}
          companyId={companyId}
          groupId={groupId}
          disabled={disabled || orderPending}
          onChange={(order) => {
            setRunOrder(order);
            setRoute(
              order ? fleetRunOrderRoute(order, Crypto.randomUUID) : null,
            );
            if (order && !zoneChosen.current) setTimeZone(order.timeZone);
          }}
        />
      ) : (
        <FleetRouteFields
          value={route}
          destinations={places}
          onChange={(value) => {
            setRunOrder(null);
            setRoute(value);
          }}
          disabled={disabled || orderPending}
        />
      )}
      <FleetChoiceField
        label={copy("Run time zone")}
        value={timeZone}
        options={zones.map((zone) => ({ id: zone, label: zone }))}
        disabled={disabled || orderPending}
        onChange={(zone) => {
          zoneChosen.current = true;
          setTimeZone(zone);
        }}
      />
      {!useOrder && route && !runOrder && (
        <FleetSaveRunOrder
          key={`${companyId}:${groupId}`}
          companyId={companyId}
          groupId={groupId}
          route={route}
          timeZone={timeZone}
          disabled={disabled}
          onPending={setOrderPending}
          onSaved={setRunOrder}
        />
      )}
      {runOrder && (
        <Text style={{ color: colors.text }}>
          {copy("Saved Run")} · {runOrder.name}
        </Text>
      )}
      <Text style={{ color: colors.text }}>
        {copy(
          "Compliance not verified. Warnings do not prevent creating this draft.",
        )}
      </Text>
      {error && (
        <TogglePillButton
          disabled={disabled || loading}
          onPress={() => setRefresh((value) => value + 1)}
        >
          {copy("Reload Details and locations")}
        </TogglePillButton>
      )}
    </View>
  );
}
