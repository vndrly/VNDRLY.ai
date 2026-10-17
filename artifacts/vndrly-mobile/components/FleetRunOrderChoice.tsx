import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  FleetRunOrderPageSchema,
  FleetRunOrderSchema,
  type FleetRunOrder,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import FleetChoiceField from "./FleetChoiceField";
import TogglePillButton from "./TogglePillButton";

export default function FleetRunOrderChoice({
  companyId,
  groupId,
  disabled,
  onChange,
  onCanManage,
}: {
  companyId: number;
  groupId: string;
  disabled: boolean;
  onChange: (order: FleetRunOrder | null) => void;
  onCanManage?: (allowed: boolean) => void;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    generation = useRef(0),
    selection = useRef(0),
    changed = useRef(onChange),
    permission = useRef(onCanManage);
  changed.current = onChange;
  permission.current = onCanManage;
  const [orders, setOrders] = useState<FleetRunOrder[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState(""),
    [saved, setSaved] = useState<FleetRunOrder | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    alive.current = true;
    permission.current?.(false);
    const request = ++generation.current;
    selection.current++;
    setOrders([]);
    setNext(null);
    setSelected("");
    setSaved(null);
    changed.current(null);
    setLoading(true);
    setError("");
    void apiFetch<unknown>("/api/fleet/run-orders", {}, scope.current)
      .then((raw) => {
        if (!current() || request !== generation.current) return;
        const page = FleetRunOrderPageSchema.parse(raw);
        if (page.orders.some((order) => order.companyId !== companyId))
          throw new Error("Company scope changed.");
        setOrders(page.orders);
        permission.current?.(page.canManage);
        setNext(page.nextCursor);
      })
      .catch(() => {
        if (current() && request === generation.current)
          permission.current?.(false);
        if (current() && request === generation.current)
          setError(copy("Saved Runs unavailable. Reload to check access."));
      })
      .finally(() => {
        if (current() && request === generation.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      generation.current++;
      selection.current++;
    };
  }, [companyId, groupId, reload]);
  async function choose(id: string) {
    const expected = orders.find((order) => order.id === id),
      request = ++selection.current;
    setSelected(id);
    setSaved(null);
    changed.current(null);
    setError("");
    if (!expected) return;
    setLoading(true);
    try {
      const order = FleetRunOrderSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/run-orders/${encodeURIComponent(id)}`,
          {},
          scope.current,
        ),
      );
      if (!current() || request !== selection.current) return;
      if (
        order.id !== id ||
        order.companyId !== companyId ||
        order.version !== expected.version ||
        order.archivedAt ||
        !order.accessGroupIds.includes(groupId)
      )
        throw new Error("Run changed.");
      setSaved(order);
      changed.current(order);
    } catch {
      if (current() && request === selection.current)
        setError(
          copy(
            "This Run changed or is unavailable. Reload and choose it again.",
          ),
        );
    } finally {
      if (current() && request === selection.current) setLoading(false);
    }
  }
  async function more() {
    if (next === null || loading) return;
    const request = generation.current;
    setLoading(true);
    try {
      const page = FleetRunOrderPageSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/run-orders?after=${next}`,
          {},
          scope.current,
        ),
      );
      if (!current() || request !== generation.current) return;
      if (page.orders.some((order) => order.companyId !== companyId))
        throw new Error("Company scope changed.");
      setOrders((prior) => [
        ...new Map(
          [...prior, ...page.orders].map((order) => [order.id, order]),
        ).values(),
      ]);
      setNext(page.nextCursor);
      permission.current?.(page.canManage);
    } catch {
      if (current() && request === generation.current)
        setError(copy("Saved Runs unavailable. Reload to check access."));
    } finally {
      if (current() && request === generation.current) setLoading(false);
    }
  }
  return (
    <View
      style={{
        gap: 10,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 12,
        backgroundColor: colors.card,
      }}
    >
      <Text style={{ color: colors.text }}>
        {copy(
          "A Run is a saved Origin and Destination transport order. Choose it, then assign your Detail and billing ticket for this activity.",
        )}
      </Text>
      <FleetChoiceField
        label={copy("Saved Run")}
        value={selected}
        disabled={disabled || loading}
        options={orders
          .filter(
            (order) =>
              !order.archivedAt && order.accessGroupIds.includes(groupId),
          )
          .map((order) => ({
            id: order.id,
            label: `${order.name} · ${order.origin.name} → ${order.destination.name}`,
          }))}
        onChange={(id) => void choose(id)}
      />
      {saved && (
        <Text style={{ color: colors.text }}>
          {saved.origin.address} → {saved.destination.address}
        </Text>
      )}
      {next !== null && (
        <TogglePillButton
          disabled={disabled || loading}
          onPress={() => void more()}
        >
          {copy("Load more Runs")}
        </TogglePillButton>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
      <TogglePillButton
        disabled={disabled || loading}
        onPress={() => setReload((value) => value + 1)}
      >
        {copy("Reload saved Runs")}
      </TogglePillButton>
    </View>
  );
}
