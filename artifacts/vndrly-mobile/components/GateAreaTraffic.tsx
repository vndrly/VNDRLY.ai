import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useGateOperatingContext } from "@/hooks/use-gate-operating-context";
import {
  readGateAreaTraffic,
  recordGateMovement,
  type GateMovementCommand,
  parallelGateGroup,
} from "@/lib/gate-traffic";
import TogglePillButton from "./TogglePillButton";
/** Native interaction adapter. Destination is intent; only a confirmed enter changes presence. */
export default function GateAreaTraffic({
  siteId,
  gateId,
}: {
  siteId: number | null;
  gateId?: string;
}) {
  const { user, activeMembershipId } = useAuth(),
    { t } = useTranslation(),
    colors = useColors(),
    cache = useQueryClient(),
    operating = useGateOperatingContext();
  const query = useQuery({
    queryKey: ["gate-area-traffic", user?.id, activeMembershipId, siteId],
    queryFn: () => readGateAreaTraffic(siteId!),
    enabled: !!siteId,
    refetchInterval: 15000,
    retry: false,
  });
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [destinations, setDestinations] = useState<Record<number, string>>({});
  const lock = useRef(false),
    operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    setPage(0);
    setDestinations({});
    setMessage("");
  }, [siteId, gateId, activeMembershipId]);
  const gates = query.data?.gates ?? [],
    gate = gates.find((row) => row.id === gateId),
    area = gate?.topology?.area;
  const allowed =
    !busy &&
    !query.isError &&
    operating.canOperate(siteId ?? undefined, gateId) &&
    !!gateId &&
    !!query.data?.movementGateIds.includes(gateId);
  const siblings = parallelGateGroup(gates, gateId);
  const rows = (query.data?.visits ?? []).filter(
    (v) =>
      !v.checkOutTime &&
      (area || !v.entryGateId || siblings.has(v.entryGateId)),
  );
  const last = Math.max(0, Math.ceil(rows.length / 25) - 1),
    current = Math.min(page, last);
  const inArea = (id: string | null) =>
    !!area && gates.find((g) => g.id === id)?.topology?.area === area;
  async function act(visitId: number, kind: GateMovementCommand["kind"]) {
    if (lock.current || !allowed || !siteId || !gateId) return;
    const destination =
      destinations[visitId] ?? (kind === "leave" ? "site_exit" : "remain");
    const parent =
      gates.find((g) => g.id === gate?.topology?.parentGateId) ?? gate;
    const named = parent?.topology?.destinations ?? [];
    const body = {
      siteId,
      gateId,
      visitId,
      kind,
      ...(kind === "enter"
        ? {}
        : destination === "site_exit" || destination === "remain"
          ? { destination }
          : named.some((d) => d.id === destination)
            ? { destinationId: destination }
            : { destinationGateId: destination }),
    } as Omit<GateMovementCommand, "operationId">;
    const key = JSON.stringify(body);
    if (operation.current?.key !== key)
      operation.current = { key, id: Crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await recordGateMovement({ ...body, operationId: operation.current.id });
      operation.current = null;
      setMessage(t("gateMovement.saved"));
      await Promise.all(
        [
          "gate-area-traffic",
          "gatekeeper-visits",
          "gate-history-report",
          "gate-coverage-map",
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("gateMovement.failed"),
      );
      await query.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!siteId) return null;
  if (query.isError)
    return (
      <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
        {t("gateMovement.failed")}
      </Text>
    );
  if (
    !gate ||
    !gates.some((g) => g.topology?.area || g.topology?.destinations?.length)
  )
    return null;
  const parent =
    gates.find((g) => g.id === gate.topology?.parentGateId) ?? gate;
  const options = (
    parent.topology?.destinations?.length
      ? parent.topology.destinations.map((d) => ({
          id: d.id,
          name: d.name,
          gateId: d.gateId,
        }))
      : gates
          .filter((g) => g.active && g.topology?.area)
          .map((g) => ({ id: g.id, name: g.name, gateId: g.id }))
  ).filter(
    (d) =>
      !area || gates.find((g) => g.id === d.gateId)?.topology?.area !== area,
  );
  return (
    <View
      style={{
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.primary,
      }}
    >
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {t("gateMovement.title")}
      </Text>
      {!allowed && (
        <Text style={{ color: colors.foreground }}>
          {t("gateOperating.readOnly")}
        </Text>
      )}
      {!!message && (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {message}
        </Text>
      )}
      {rows.slice(current * 25, (current + 1) * 25).map((v) => (
        <View key={v.id} style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground }}>
            {v.firstName} {v.lastName} · {v.vehiclePlate}
          </Text>
          <Text style={{ color: colors.foreground }}>{v.presence.label}</Text>
          {area && !inArea(v.presence.currentGateId) && (
            <TogglePillButton
              disabled={!allowed}
              onPress={() => void act(v.id, "enter")}
            >
              {t("gateMovement.enter")}
            </TogglePillButton>
          )}
          {(inArea(v.presence.currentGateId) ||
            (!area &&
              !gates.find((g) => g.id === v.presence.currentGateId)?.topology
                ?.area)) && (
            <>
              <Text style={{ color: colors.foreground }}>
                {t("gateMovement.destination")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {[
                  { id: "remain", name: t("gateMovement.remain") },
                  ...(area
                    ? [{ id: "site_exit", name: t("gateMovement.exit") }]
                    : []),
                  ...options,
                ].map((d) => (
                  <TogglePillButton
                    key={d.id}
                    disabled={!allowed}
                    onPress={() =>
                      setDestinations((p) => ({ ...p, [v.id]: d.id }))
                    }
                  >
                    {(destinations[v.id] ?? (area ? "site_exit" : "remain")) ===
                    d.id
                      ? "✓ "
                      : ""}
                    {d.name}
                  </TogglePillButton>
                ))}
              </View>
              <TogglePillButton
                disabled={!allowed}
                onPress={() => void act(v.id, area ? "leave" : "route")}
              >
                {t(area ? "gateMovement.leave" : "gateMovement.route")}
              </TogglePillButton>
            </>
          )}
        </View>
      ))}
      {!rows.length && (
        <Text style={{ color: colors.foreground }}>
          {t("gateMovement.empty")}
        </Text>
      )}
      {rows.length > 25 && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TogglePillButton
            disabled={current === 0}
            onPress={() => setPage(current - 1)}
          >
            {t("common.previous")}
          </TogglePillButton>
          <Text style={{ color: colors.foreground }}>
            {current + 1}/{last + 1}
          </Text>
          <TogglePillButton
            disabled={current === last}
            onPress={() => setPage(current + 1)}
          >
            {t("common.next")}
          </TogglePillButton>
        </View>
      )}
    </View>
  );
}
