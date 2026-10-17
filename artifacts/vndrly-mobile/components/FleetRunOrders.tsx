import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetCanonicalIdSchema,
  FleetDestinationDirectorySchema,
  FleetRunOrderHistorySchema,
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

export default function FleetRunOrders({ companyId }: { companyId: number }) {
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
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    alive.current = true;
    const request = ++contextGeneration.current;
    setError("");
    void Promise.all([
      apiFetch<FleetOverview>("/api/fleet", {}, scope.current),
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
                    setSelected(null);
                    setRoute(null);
                    setEditing(true);
                    setHistory(null);
                  }}
                >
                  {copy("New saved Run")}
                </TogglePillButton>
              )}
              {selected && !editing && (
                <View style={{ gap: 8 }}>
                  {canManage && (
                    <TogglePillButton
                      disabled={pending}
                      onPress={() => {
                        setRoute(
                          fleetRunOrderRoute(selected, Crypto.randomUUID),
                        );
                        setZone(selected.timeZone);
                        setEditing(true);
                        setHistory(null);
                      }}
                    >
                      {copy("Edit selected Run")}
                    </TogglePillButton>
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
                  <FleetRouteFields
                    key={`${selected?.id ?? "new"}:${selected?.version ?? 0}`}
                    value={route}
                    destinations={places}
                    disabled={pending || !canManage}
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
                      disabled={!canManage}
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
