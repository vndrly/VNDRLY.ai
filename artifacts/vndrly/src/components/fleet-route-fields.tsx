import { useState } from "react";
import {
  FleetRoutePlanSchema,
  type FleetRoutePlan,
  type FleetDestination,
} from "@workspace/api-zod";
import { PngPillButton } from "./png-pill-rollover";
type Cycle = {
  id: string;
  pickupId: string;
  deliveryId: string;
  origin: string;
  destination: string;
};
export function FleetRouteFields({
  value,
  destinations,
  onChange,
}: {
  value: FleetRoutePlan | null;
  destinations: FleetDestination[];
  onChange: (value: FleetRoutePlan | null) => void;
}) {
  const locationId = (reference: FleetRoutePlan["origin"] | null) =>
    reference?.type === "canonical" ? reference.location.id : "";
  const [cycles, setCycles] = useState<Cycle[]>(() => {
    if (!value)
      return [
        {
          id: crypto.randomUUID(),
          pickupId: crypto.randomUUID(),
          deliveryId: crypto.randomUUID(),
          origin: "",
          destination: "",
        },
      ];
    let origin = locationId(value.origin);
    const rows: Cycle[] = [];
    for (const stop of value.stops) {
      if (stop.kind === "pickup") origin = locationId(stop.location);
      if (stop.kind === "delivery")
        rows.push({
          id: stop.cycleId ?? crypto.randomUUID(),
          pickupId: crypto.randomUUID(),
          deliveryId: stop.id,
          origin,
          destination: locationId(stop.location),
        });
    }
    return rows;
  });
  const [policy, setPolicy] = useState(value?.returnPolicy ?? "delivery_only"),
    [base, setBase] = useState(locationId(value?.base ?? null)),
    [returnId] = useState(
      () =>
        value?.stops.find((stop) => stop.kind === "return")?.id ??
        crypto.randomUUID(),
    );
  const choices = destinations.filter((item) => item.active);
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
    });
    const stops: FleetRoutePlan["stops"] = [];
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
      i === index ? { ...cycle, [field]: id } : cycle,
    );
    setCycles(next);
    publish(next, policy, base);
  }
  function select(label: string, id: string, choose: (value: string) => void) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={id}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">Choose location</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.address}
              {item.latitude === null ? " · GPS unverified" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="space-y-4" aria-label="Physical route">
      <h3>Physical route</h3>
      <p>
        Choose the actual places visited. Billing site, customer and AFE stay
        separate.
      </p>
      {cycles.map((cycle, index) => (
        <div className="fleet-detail-group space-y-3" key={cycle.id}>
          <strong>Cycle {index + 1}</strong>
          <div className="fleet-asset-fields">
            {select(
              index ? `Origin ${index + 1}` : "Origin",
              cycle.origin,
              (id) => update(index, "origin", id),
            )}
            {select(
              index ? `Destination ${index + 1}` : "Destination",
              cycle.destination,
              (id) => update(index, "destination", id),
            )}
          </div>
          {index > 0 && (
            <PngPillButton
              onClick={() => {
                const next = cycles.filter((item) => item.id !== cycle.id);
                setCycles(next);
                publish(next, policy, base);
              }}
            >
              Remove cycle {index + 1}
            </PngPillButton>
          )}
        </div>
      ))}
      <PngPillButton
        onClick={() => {
          const last = cycles.at(-1)!;
          const next = [
            ...cycles,
            {
              ...last,
              id: crypto.randomUUID(),
              pickupId: crypto.randomUUID(),
              deliveryId: crypto.randomUUID(),
            },
          ];
          setCycles(next);
          publish(next, policy, base);
        }}
      >
        Repeat pickup / delivery cycle
      </PngPillButton>
      <label>
        Return policy
        <select
          aria-label="Return policy"
          value={policy}
          onChange={(e) => {
            const next = e.target.value as typeof policy;
            setPolicy(next);
            publish(cycles, next, base);
          }}
        >
          <option value="delivery_only">
            Delivery only · release after closeout
          </option>
          <option value="return_required">
            Return to base before closeout
          </option>
        </select>
      </label>
      {policy === "return_required" &&
        select("Return base", base, (id) => {
          setBase(id);
          publish(cycles, policy, id);
        })}
      <p>
        Map estimates need verified coordinates. GPS gaps do not prevent
        choosing or recording the location.
      </p>
    </div>
  );
}
