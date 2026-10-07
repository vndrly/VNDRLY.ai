import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { FleetActionInput, FleetRun, FleetResources } from "@workspace/api-zod";
import { FleetActionInputSchema } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";

export default function FleetRunAction({ run, action, disabled, onSubmit, tickets = [] }: { run: FleetRun; action: FleetActionInput["action"]; disabled: boolean; onSubmit: (fields: Partial<FleetActionInput>) => void; tickets?: NonNullable<FleetResources["tickets"]> }) {
  const colors = useColors();
  const [values, setValues] = useState<Record<string, string>>({});
  const [stopId, setStopId] = useState(run.currentStopId ?? "");
  const [loadId, setLoadId] = useState("");
  const [inspectionOutcome, setInspectionOutcome] = useState<"passed" | "defect_reported">("defect_reported");
  const [decision, setDecision] = useState<"accept" | "return">("return");
  const [unit, setUnit] = useState("");
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fields = action === "inspect" || action === "submit_closeout" ? ["notes"] : action === "record_load" ? ["commodity", "quantity", "unit", "manifestReference"] : action === "record_delivery" ? ["deliveryReference"] : ["cancel", "review", "pause"].includes(action) ? ["reason"] : action === "record_fuel" ? ["quantity", "notes"] : action === "record_meter" ? ["reading", "notes"] : [];
  function submit() {
    const input: Partial<FleetActionInput> = {};
    for (const field of fields) Object.assign(input, { [field]: ["quantity", "reading", "ticketId"].includes(field) ? Number(values[field]) : values[field] });
    if (["record_fuel", "record_meter"].includes(action)) input.unit = unit;
    if (action === "link_ticket" && ticketId) input.ticketId = ticketId;
    if (action === "inspect") input.inspectionOutcome = inspectionOutcome;
    if (action === "review") input.decision = decision;
    if (["arrive_stop", "depart_stop"].includes(action)) input.stopId = stopId;
    if (action === "record_load") input.loadId = Crypto.randomUUID();
    if (action === "record_delivery") input.loadId = loadId;
    const parsed = FleetActionInputSchema.safeParse({ ...input, action, expectedVersion: run.version, operationId: Crypto.randomUUID() });
    if (!parsed.success || fields.some(field => !values[field]?.trim()) || (["arrive_stop", "depart_stop"].includes(action) && !stopId) || (action === "record_delivery" && !loadId) || (action === "link_ticket" && !ticketId)) { setError("Complete the required fields and select the exact stop, load or ticket."); return; }
    setError(""); onSubmit(input);
  }
  return <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{action.replaceAll("_", " ")}</Text>
    {["inspect", "arrive_stop", "depart_stop", "record_load", "record_delivery"].includes(action) && <Text style={{ color: colors.text }}>Records your report. No device location, photograph, signature or regulatory inspection evidence is captured here. Complete detailed forms while stopped.</Text>}
    {fields.map(field => <TextInput key={field} accessibilityLabel={`${action} ${field}`} placeholder={field.replaceAll(/([A-Z])/g, " $1")} value={values[field] ?? ""} keyboardType={field === "quantity" ? "decimal-pad" : "default"} onChangeText={value => setValues(v => ({ ...v, [field]: value }))} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }} />)}
    {action === "inspect" && <><TogglePillButton solid={inspectionOutcome === "defect_reported"} onPress={() => setInspectionOutcome("defect_reported")}>Report defect</TogglePillButton><TogglePillButton solid={inspectionOutcome === "passed"} onPress={() => setInspectionOutcome("passed")}>Report inspection passed</TogglePillButton></>}
    {action === "review" && <><TogglePillButton solid={decision === "return"} onPress={() => setDecision("return")}>Return for correction</TogglePillButton><TogglePillButton solid={decision === "accept"} onPress={() => setDecision("accept")}>Accept Fleet closeout</TogglePillButton><Text style={{ color: colors.text }}>Fleet review does not approve a commercial ticket or record payment.</Text></>}
    {action === "submit_closeout" && <Text style={{ color: colors.text }}>Submit recorded stops and load/delivery references for review. This does not approve billing or verify physical proof.</Text>}
    {action === "link_ticket" && <><Text style={{ color: colors.text }}>Choose an authorized existing ticket for this run's sites. Linking does not change ticket status or approve billing.</Text>{tickets.length === 0 && <Text style={{ color: colors.text }}>No eligible existing tickets are available.</Text>}{tickets.map(ticket => <TogglePillButton key={ticket.id} solid={ticketId === ticket.id} onPress={() => setTicketId(ticket.id)}>Ticket #{ticket.id} · site {ticket.siteId} · {ticket.status}</TogglePillButton>)}</>}
    {(["record_fuel", "record_meter"].includes(action)) && (action === "record_fuel" ? ["gallons", "liters"] : ["miles", "kilometers", "engine_hours"]).map(value => <TogglePillButton key={value} solid={unit === value} onPress={() => setUnit(value)}>{value.replaceAll("_", " ")}</TogglePillButton>)}
    {["arrive_stop", "depart_stop"].includes(action) && run.stops.map(stop => <TogglePillButton key={stop.id} solid={stopId === stop.id} onPress={() => setStopId(stop.id)}>{stop.sequence + 1}. {stop.kind} · {run.labels?.sites.find(site => site.siteId === stop.siteId)?.name ?? `site ${stop.siteId}`}</TogglePillButton>)}
    {action === "record_delivery" && run.loads.filter(load => !load.deliveredAt).map(load => <TogglePillButton key={load.id} solid={loadId === load.id} onPress={() => setLoadId(load.id)}>{load.commodity} · {load.quantity} {load.unit} · {load.manifestReference}</TogglePillButton>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    <TogglePillButton disabled={disabled} onPress={submit}>{action.replaceAll("_", " ")}</TogglePillButton>
  </View>;
}
