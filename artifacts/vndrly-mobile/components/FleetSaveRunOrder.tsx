import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetRunOrderReceiptSchema,
  FleetRunOrderSaveSchema,
  fleetRunOrderFromRoute,
  type FleetRunOrder,
  type FleetRoutePlan,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "./TogglePillButton";

export default function FleetSaveRunOrder({
  companyId,
  groupId,
  route,
  timeZone,
  initialName = "",
  disabled,
  onPending,
  onSaved,
}: {
  companyId: number;
  groupId: string;
  route: FleetRoutePlan;
  timeZone: string;
  initialName?: string;
  disabled: boolean;
  onPending: (pending: boolean) => void;
  onSaved: (order: FleetRunOrder) => void;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    request = useRef<z.infer<typeof FleetRunOrderSaveSchema> | null>(null);
  const [name, setName] = useState(initialName),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function save() {
    if (disabled || busy || !current()) return;
    try {
      if (!request.current)
        request.current = FleetRunOrderSaveSchema.parse({
          operationId: Crypto.randomUUID(),
          expectedVersion: 0,
          order: fleetRunOrderFromRoute({
            id: Crypto.randomUUID(),
            companyId,
            accessGroupIds: [groupId],
            name,
            timeZone,
            route,
          }),
        });
    } catch {
      setError(
        copy(
          "Name this Run and choose a matching Origin and Destination pair.",
        ),
      );
      return;
    }
    const body = request.current;
    setBusy(true);
    setPending(true);
    setError("");
    onPending(true);
    let accepted = false;
    try {
      await apiFetch(
        "/api/fleet/run-orders",
        { method: "POST", body: JSON.stringify(body) },
        scope.current,
      );
      accepted = true;
      const receipt = FleetRunOrderReceiptSchema.parse(
        await apiFetch<unknown>(
          `/api/fleet/run-orders/operations/${body.operationId}`,
          {},
          scope.current,
        ),
      );
      if (!current()) return;
      if (
        receipt.operationId !== body.operationId ||
        JSON.stringify(receipt.order) !== JSON.stringify(body.order)
      )
        throw new Error("Saved Run readback changed.");
      request.current = null;
      setPending(false);
      onPending(false);
      onSaved(receipt.order);
    } catch (error) {
      if (!current()) return;
      const status = (error as { status?: number })?.status;
      if (
        !accepted &&
        status &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        request.current = null;
        setPending(false);
        onPending(false);
      }
      setError(
        copy(
          "Run save needs verification. Retry the same request; no ticket or Detail was created.",
        ),
      );
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <View
      style={{
        gap: 8,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 12,
        backgroundColor: colors.card,
      }}
    >
      <Text style={{ color: colors.text }}>
        {copy(
          "Save the Origin and Destination pair for repeat dispatch. Each activity still needs its own new or shared ticket choice.",
        )}
      </Text>
      <TextInput
        accessibilityLabel={copy("Saved Run name")}
        placeholder={copy("Saved Run name")}
        value={name}
        editable={!disabled && !pending && !busy}
        maxLength={200}
        onChangeText={setName}
        style={{
          color: colors.text,
          borderWidth: 2,
          borderColor: colors.primary,
          borderRadius: 8,
          padding: 10,
        }}
      />
      <TogglePillButton
        disabled={disabled || busy || (!pending && !name.trim())}
        onPress={() => void save()}
      >
        {copy(pending ? "Retry saving this Run" : "Save this route as a Run")}
      </TogglePillButton>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
    </View>
  );
}
