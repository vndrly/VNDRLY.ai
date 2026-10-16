import React, { useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  FleetRoutePlanSchema,
  type FleetRoutePlan,
  type FleetDestination,
} from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import FleetChoiceField from "./FleetChoiceField";
import TogglePillButton from "./TogglePillButton";
type Cycle = {
  id: string;
  pickupId: string;
  deliveryId: string;
  origin: string;
  destination: string;
};
export default function FleetRouteFields({
  value,
  destinations,
  onChange,
}: {
  value: FleetRoutePlan | null;
  destinations: FleetDestination[];
  onChange: (value: FleetRoutePlan | null) => void;
}) {
  const colors = useColors(),
    text = { color: colors.text };
  const idOf = (reference: FleetRoutePlan["origin"] | null) =>
    reference?.type === "canonical" ? reference.location.id : "";
  const [cycles, setCycles] = useState<Cycle[]>(() => {
    if (!value)
      return [
        {
          id: Crypto.randomUUID(),
          pickupId: Crypto.randomUUID(),
          deliveryId: Crypto.randomUUID(),
          origin: "",
          destination: "",
        },
      ];
    let origin = idOf(value.origin),
      pickupId = Crypto.randomUUID();
    const rows: Cycle[] = [];
    for (const stop of value.stops) {
      if (stop.kind === "pickup") {
        origin = idOf(stop.location);
        pickupId = stop.id;
      }
      if (stop.kind === "delivery")
        rows.push({
          id: stop.cycleId ?? Crypto.randomUUID(),
          pickupId,
          deliveryId: stop.id,
          origin,
          destination: idOf(stop.location),
        });
    }
    return rows;
  });
  const [policy, setPolicy] = useState(value?.returnPolicy ?? "delivery_only"),
    [base, setBase] = useState(idOf(value?.base ?? null)),
    [returnId] = useState(
      () =>
        value?.stops.find((stop) => stop.kind === "return")?.id ??
        Crypto.randomUUID(),
    );
  const choices = destinations.filter((item) => item.active),
    options = choices.map((item) => ({ id: item.id, label: item.name }));
  function publish(next: Cycle[], nextPolicy: typeof policy, nextBase: string) {
    const find = (id: string) => choices.find((item) => item.id === id);
    if (
      !next.length ||
      next.some((item) => !find(item.origin) || !find(item.destination)) ||
      (nextPolicy === "return_required" && !find(nextBase))
    ) {
      onChange(null);
      return;
    }
    const reference = (id: string) => ({
        type: "canonical" as const,
        location: find(id)!,
      }),
      stops: FleetRoutePlan["stops"] = [];
    for (const [index, cycle] of next.entries()) {
      if (index)
        stops.push({
          id: cycle.pickupId,
          sequence: stops.length,
          kind: "pickup",
          cycleId: cycle.id,
          location: reference(cycle.origin),
        });
      stops.push({
        id: cycle.deliveryId,
        sequence: stops.length,
        kind: "delivery",
        cycleId: cycle.id,
        location: reference(cycle.destination),
      });
    }
    if (nextPolicy === "return_required")
      stops.push({
        id: returnId,
        sequence: stops.length,
        kind: "return",
        cycleId: null,
        location: reference(nextBase),
      });
    const parsed = FleetRoutePlanSchema.safeParse({
      origin: reference(next[0].origin),
      stops,
      returnPolicy: nextPolicy,
      base: nextPolicy === "return_required" ? reference(nextBase) : null,
      plannedWindow: value?.plannedWindow ?? null,
    });
    onChange(parsed.success ? parsed.data : null);
  }
  function update(index: number, field: "origin" | "destination", id: string) {
    const next = cycles.map((cycle, i) =>
      index === i ? { ...cycle, [field]: id } : cycle,
    );
    setCycles(next);
    publish(next, policy, base);
  }
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 16,
        gap: 14,
      }}
    >
      <Text style={[text, { fontSize: 18, fontWeight: "700" }]}>
        Physical route
      </Text>
      <Text style={text}>
        Actual places visited. Billing site, customer and AFE stay separate.
      </Text>
      {cycles.map((cycle, index) => (
        <View key={cycle.id} style={{ gap: 10 }}>
          <Text style={text}>Cycle {index + 1}</Text>
          <FleetChoiceField
            label={index ? `Origin ${index + 1}` : "Origin"}
            value={cycle.origin}
            options={options}
            onChange={(id) => update(index, "origin", id)}
          />
          <FleetChoiceField
            label={index ? `Destination ${index + 1}` : "Destination"}
            value={cycle.destination}
            options={options}
            onChange={(id) => update(index, "destination", id)}
          />
          {index > 0 && (
            <TogglePillButton
              onPress={() => {
                const next = cycles.filter((item) => item.id !== cycle.id);
                setCycles(next);
                publish(next, policy, base);
              }}
            >
              Remove cycle {index + 1}
            </TogglePillButton>
          )}
        </View>
      ))}
      <TogglePillButton
        onPress={() => {
          const last = cycles.at(-1)!;
          const next = [
            ...cycles,
            {
              ...last,
              id: Crypto.randomUUID(),
              pickupId: Crypto.randomUUID(),
              deliveryId: Crypto.randomUUID(),
            },
          ];
          setCycles(next);
          publish(next, policy, base);
        }}
      >
        Repeat pickup / delivery cycle
      </TogglePillButton>
      <FleetChoiceField
        label="Return policy"
        value={policy}
        options={[
          { id: "delivery_only", label: "Delivery only" },
          { id: "return_required", label: "Return to base before closeout" },
        ]}
        onChange={(id) => {
          const next = id as typeof policy;
          setPolicy(next);
          publish(cycles, next, base);
        }}
      />
      {policy === "return_required" && (
        <FleetChoiceField
          label="Return base"
          value={base}
          options={options}
          onChange={(id) => {
            setBase(id);
            publish(cycles, policy, id);
          }}
        />
      )}
      <Text style={text}>
        GPS unverified locations remain selectable. Estimates require
        coordinates.
      </Text>
    </View>
  );
}
