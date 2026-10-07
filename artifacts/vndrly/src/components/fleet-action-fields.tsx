import type {
  FleetActionInput,
  FleetRun,
  FleetResources,
} from "@workspace/api-zod";
export function FleetActionFields({
  run,
  input,
  onChange,
  disabled,
  tickets = [],
}: {
  run: FleetRun;
  input: FleetActionInput;
  onChange: (input: FleetActionInput) => void;
  disabled: boolean;
  tickets?: FleetResources["tickets"];
}) {
  const update = (fields: Partial<FleetActionInput>) =>
    onChange({ ...input, ...fields });
  const text = (
    key:
      | "notes"
      | "commodity"
      | "unit"
      | "manifestReference"
      | "deliveryReference"
      | "reason",
    label: string,
  ) => (
    <label className="block text-sm">
      {label}
      <input
        disabled={disabled}
        className="mt-1 block w-full rounded border bg-background p-2"
        value={input[key] ?? ""}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="space-y-2">
      {input.action === "pause" && text("reason", "Pause reason")}
      {(input.action === "record_fuel" || input.action === "record_meter") && (
        <>
          <p className="text-xs">
            User-reported reading. No hardware measurement or fuel purchase is
            inferred.
          </p>
          <label className="block">
            {input.action === "record_meter"
              ? "Meter reading"
              : "Fuel quantity"}
            <input
              disabled={disabled}
              type="number"
              min="0"
              step="any"
              value={
                (input.action === "record_meter"
                  ? input.reading
                  : input.quantity) ?? ""
              }
              onChange={(e) =>
                update(
                  input.action === "record_meter"
                    ? { reading: Number(e.target.value) }
                    : { quantity: Number(e.target.value) },
                )
              }
            />
          </label>
          <label className="block">
            Unit
            <select
              disabled={disabled}
              value={input.unit ?? ""}
              onChange={(e) => update({ unit: e.target.value })}
            >
              <option value="">Choose unit</option>
              {(input.action === "record_meter"
                ? ["miles", "kilometers", "engine_hours"]
                : ["gallons", "liters"]
              ).map((unit) => (
                <option key={unit} value={unit}>
                  {unit.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {text("notes", "Reading notes")}
        </>
      )}
      {input.action === "link_ticket" && (
        <>
          <p className="text-xs">
            Links an existing authorized ticket. Billing and ticket status stay
            in their existing workflow.
          </p>
          <label className="block">
            Existing ticket number
            <select
              disabled={disabled}
              value={input.ticketId ?? ""}
              onChange={(e) => update({ ticketId: Number(e.target.value) })}
            >
              <option value="">Choose authorized ticket</option>
              {tickets
                .filter((ticket) => run.siteIds.includes(ticket.siteId))
                .map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    #{ticket.id} · Site {ticket.siteId} ·{" "}
                    {ticket.status.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      {input.action === "submit_closeout" &&
        text("notes", "Closeout / correction notes")}
      {input.action === "inspect" && (
        <>
          <p className="text-xs">
            Driver report only. This does not certify a regulatory inspection.
          </p>
          <label className="block">
            Inspection report
            <select
              disabled={disabled}
              value={input.inspectionOutcome ?? ""}
              onChange={(e) =>
                update({
                  inspectionOutcome: e.target.value as
                    | "passed"
                    | "defect_reported",
                })
              }
            >
              <option value="">Choose outcome</option>
              <option value="passed">Passed — driver reported</option>
              <option value="defect_reported">Defect reported</option>
            </select>
          </label>
          {text("notes", "Inspection notes")}
        </>
      )}
      {(input.action === "arrive_stop" || input.action === "depart_stop") && (
        <label className="block">
          Stop
          <select
            disabled={disabled}
            value={input.stopId ?? ""}
            onChange={(e) => update({ stopId: e.target.value })}
          >
            <option value="">Choose stop</option>
            {[...run.stops]
              .sort((a, b) => a.sequence - b.sequence)
              .map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.sequence + 1}. {stop.kind} · Site {stop.siteId}
                </option>
              ))}
          </select>
        </label>
      )}
      {input.action === "record_load" && (
        <>
          {text("commodity", "Commodity")}
          <label className="block">
            Quantity
            <input
              disabled={disabled}
              type="number"
              min="0"
              step="any"
              value={input.quantity ?? ""}
              onChange={(e) => update({ quantity: Number(e.target.value) })}
            />
          </label>
          {text("unit", "Unit")}
          {text("manifestReference", "Manifest reference")}
        </>
      )}
      {input.action === "record_delivery" && (
        <>
          <label className="block">
            Load
            <select
              disabled={disabled}
              value={input.loadId ?? ""}
              onChange={(e) => update({ loadId: e.target.value })}
            >
              <option value="">Choose undelivered load</option>
              {run.loads
                .filter((load) => !load.deliveredAt)
                .map((load) => (
                  <option key={load.id} value={load.id}>
                    {load.commodity} · {load.quantity} {load.unit} ·{" "}
                    {load.manifestReference}
                  </option>
                ))}
            </select>
          </label>
          {text("deliveryReference", "Delivery reference")}
        </>
      )}
      {input.action === "review" && (
        <>
          <label className="block">
            Closeout decision
            <select
              disabled={disabled}
              value={input.decision ?? ""}
              onChange={(e) =>
                update({ decision: e.target.value as "accept" | "return" })
              }
            >
              <option value="">Choose decision</option>
              <option value="accept">Accept operational closeout</option>
              <option value="return">Return for correction</option>
            </select>
          </label>
          {text("reason", "Review reason")}
        </>
      )}
    </div>
  );
}
export function fleetActionComplete(
  input: FleetActionInput,
  run?: FleetRun,
): boolean {
  const present = (value?: string) => Boolean(value?.trim());
  switch (input.action) {
    case "pause":
      return present(input.reason);
    case "record_meter":
      return (
        input.reading !== undefined &&
        input.reading >= 0 &&
        Number.isFinite(input.reading) &&
        ["miles", "kilometers", "engine_hours"].includes(input.unit ?? "") &&
        present(input.notes)
      );
    case "record_fuel":
      return (
        Boolean(
          input.quantity &&
          input.quantity > 0 &&
          Number.isFinite(input.quantity),
        ) &&
        ["gallons", "liters"].includes(input.unit ?? "") &&
        present(input.notes)
      );
    case "link_ticket":
      return Boolean(
        input.ticketId &&
        Number.isSafeInteger(input.ticketId) &&
        input.ticketId > 0,
      );
    case "submit_closeout":
      return run?.events.at(-1)?.type === "review" &&
        run.events.at(-1)?.details?.decision === "return"
        ? present(input.notes)
        : true;
    case "inspect":
      return Boolean(input.inspectionOutcome && present(input.notes));
    case "arrive_stop":
    case "depart_stop":
      return present(input.stopId);
    case "record_load":
      return (
        present(input.commodity) &&
        Boolean(
          input.quantity &&
          input.quantity > 0 &&
          Number.isFinite(input.quantity),
        ) &&
        present(input.unit) &&
        present(input.manifestReference)
      );
    case "record_delivery":
      return present(input.loadId) && present(input.deliveryReference);
    case "review":
      return Boolean(input.decision && present(input.reason));
    case "cancel":
      return present(input.reason);
    case "reassign":
      return Boolean(
        input.driverUserId ||
        input.vehicleAssetId ||
        input.trailerAssetId !== undefined,
      );
    default:
      return true;
  }
}
