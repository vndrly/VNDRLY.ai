import { useFleetCopy } from "@/lib/fleet-copy";
import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { FleetActionInput, FleetRun, FleetResources } from "@workspace/api-zod";
import { FleetActionInputSchema, checkFleetInspectionRequirements, checkFleetManifestRequirements, type FleetInspectionResponses } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
export default function FleetRunAction({ run, action, disabled, onSubmit, tickets = [] }: {
    run: Pick<FleetRun, "version" | "currentStopId" | "stops" | "labels" | "operationalProfile"> & { loads: { id: string; commodity: string; quantity: number; unit: string; manifestReference: string; deliveredAt?: string | null; delivered?: boolean }[] };
    action: FleetActionInput["action"];
    disabled: boolean;
    onSubmit: (fields: Partial<FleetActionInput>) => void;
    tickets?: NonNullable<FleetResources["tickets"]>;
}) {
    const colors = useColors();
    const copy = useFleetCopy();
    const [values, setValues] = useState<Record<string, string>>({});
    const [stopId, setStopId] = useState(run.currentStopId ?? "");
    const [loadId, setLoadId] = useState("");
    const [inspectionOutcome, setInspectionOutcome] = useState<"passed" | "defect_reported">("defect_reported");
    const [decision, setDecision] = useState<"accept" | "return">("return");
    const [unit, setUnit] = useState("");
    const [ticketId, setTicketId] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [responses,setResponses]=useState<FleetInspectionResponses>([]);
    const [manifest,setManifest]=useState<Record<string,string>>({});
    const fields = action === "inspect" || action === "submit_closeout" ? ["notes"] : action === "record_load" ? ["commodity", "quantity", "unit", "manifestReference"] : action === "record_delivery" ? ["deliveryReference"] : ["cancel", "review", "pause"].includes(action) ? ["reason"] : action === "record_fuel" ? ["quantity", "notes"] : action === "record_meter" ? ["reading", "notes"] : [];
    function submit() {
        const input: Partial<FleetActionInput> = {};
        for (const field of fields)
            Object.assign(input, { [field]: ["quantity", "reading", "ticketId"].includes(field) ? Number(values[field]) : values[field] });
        if (["record_fuel", "record_meter"].includes(action))
            input.unit = unit;
        if (action === "link_ticket" && ticketId)
            input.ticketId = ticketId;
        if (action === "inspect") {
            input.inspectionOutcome = inspectionOutcome;
            if(run.operationalProfile)input.inspectionResponses = responses;
            if(!checkFleetInspectionRequirements(run.operationalProfile,responses,inspectionOutcome)){setError("Answer the required inspection items. A reported defect cannot be marked passed.");return;}
        }
        if (action === "review")
            input.decision = decision;
        if (["arrive_stop", "depart_stop"].includes(action))
            input.stopId = stopId;
        if (action === "record_load") {
            input.loadId = Crypto.randomUUID();
            if(run.operationalProfile)input.manifestValues=manifest;
            if(!checkFleetManifestRequirements(run.operationalProfile,manifest)){setError("Complete the required manifest fields for this run's saved profile.");return;}
        }
        if (action === "record_delivery")
            input.loadId = loadId;
        const parsed = FleetActionInputSchema.safeParse({ ...input, action, expectedVersion: run.version, operationId: Crypto.randomUUID() });
        if (!parsed.success || fields.some(field => !values[field]?.trim()) || (["arrive_stop", "depart_stop"].includes(action) && !stopId) || (action === "record_delivery" && !loadId) || (action === "link_ticket" && !ticketId)) {
            setError("Complete the required fields and select the exact stop, load or ticket.");
            return;
        }
        setError("");
        onSubmit(input);
    }
    return <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
    <Text style={{ color: colors.text, fontWeight: "700" }}>{copy(action.replaceAll("_", " "))}</Text>
    {["inspect", "arrive_stop", "depart_stop", "record_load", "record_delivery"].includes(action) && <Text style={{ color: colors.text }}>{copy("Records your report. No device location, photograph, signature or regulatory inspection evidence is captured here. Complete detailed forms while stopped.")}</Text>}
    {fields.map(field => <TextInput key={field} accessibilityLabel={`${copy(action)} ${copy(field)}`} placeholder={copy(field.replaceAll(/([A-Z])/g, " $1"))} value={values[field] ?? ""} keyboardType={field === "quantity" ? "decimal-pad" : "default"} onChangeText={value => setValues(v => ({ ...v, [field]: value }))} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}/>)}
    {action === "inspect" && <><TogglePillButton solid={inspectionOutcome === "defect_reported"} onPress={() => setInspectionOutcome("defect_reported")}>{copy("Report defect")}</TogglePillButton><TogglePillButton solid={inspectionOutcome === "passed"} onPress={() => setInspectionOutcome("passed")}>{copy("Report inspection passed")}</TogglePillButton></>}
    {action === "inspect" && run.operationalProfile?.inspectionItems.map(item=><View key={item.id} style={{gap:8}}><Text style={{color:colors.text}}>{item.label} · {copy(item.required?"Required":"Optional")}</Text>{(["passed","defect_reported","not_applicable"] as const).filter(outcome=>!item.required || outcome!=="not_applicable").map(outcome=><TogglePillButton key={outcome} solid={responses.some(response=>response.id===item.id&&response.outcome===outcome)} onPress={()=>setResponses(current=>[...current.filter(response=>response.id!==item.id),{id:item.id,outcome}])}>{item.label}: {copy(outcome.replaceAll("_"," "))}</TogglePillButton>)}</View>)}
    {action === "record_load" && run.operationalProfile?.manifestFields.map(item=><TextInput key={item.id} accessibilityLabel={item.label} placeholder={`${item.label} · ${copy(item.required?"Required":"Optional")}`} value={manifest[item.id]??""} onChangeText={value=>setManifest(current=>{const next={...current};if(value.trim())next[item.id]=value;else delete next[item.id];return next;})} style={{color:colors.text,padding:12,borderWidth:1,borderColor:colors.border}}/>)}
    {action === "review" && <><TogglePillButton solid={decision === "return"} onPress={() => setDecision("return")}>{copy("Return for correction")}</TogglePillButton><TogglePillButton solid={decision === "accept"} onPress={() => setDecision("accept")}>{copy("Accept Fleet closeout")}</TogglePillButton><Text style={{ color: colors.text }}>{copy("Fleet review does not approve a commercial ticket or record payment.")}</Text></>}
    {action === "submit_closeout" && <Text style={{ color: colors.text }}>{copy("Submit recorded stops and load/delivery references for review. This does not approve billing or verify physical proof.")}</Text>}
    {action === "link_ticket" && <><Text style={{ color: colors.text }}>{copy("Choose an authorized existing ticket for this run's sites. Linking does not change ticket status or approve billing.")}</Text>{tickets.length === 0 && <Text style={{ color: colors.text }}>{copy("No eligible existing tickets are available.")}</Text>}{tickets.map(ticket => <TogglePillButton key={ticket.id} solid={ticketId === ticket.id} onPress={() => setTicketId(ticket.id)}>{copy("Ticket #")}{ticket.id}{copy(" \u00B7 site ")}{ticket.siteId}{copy(" \u00B7 ")}{ticket.status}</TogglePillButton>)}</>}
    {(["record_fuel", "record_meter"].includes(action)) && (action === "record_fuel" ? ["gallons", "liters"] : ["miles", "kilometers", "engine_hours"]).map(value => <TogglePillButton key={value} solid={unit === value} onPress={() => setUnit(value)}>{copy(value.replaceAll("_", " "))}</TogglePillButton>)}
    {["arrive_stop", "depart_stop"].includes(action) && run.stops.map(stop => <TogglePillButton key={stop.id} solid={stopId === stop.id} onPress={() => setStopId(stop.id)}>{stop.sequence + 1}{copy(". ")}{copy(stop.kind)}{copy(" \u00B7 ")}{run.labels?.sites.find(site => site.siteId === stop.siteId)?.name ?? `site ${stop.siteId}`}</TogglePillButton>)}
    {action === "record_delivery" && run.loads.filter(load => !load.deliveredAt && !load.delivered).map(load => <TogglePillButton key={load.id} solid={loadId === load.id} onPress={() => setLoadId(load.id)}>{load.commodity}{copy(" \u00B7 ")}{load.quantity} {load.unit}{copy(" \u00B7 ")}{load.manifestReference}</TogglePillButton>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(error)}</Text>}
    <TogglePillButton disabled={disabled} onPress={submit}>{copy(action.replaceAll("_", " "))}</TogglePillButton>
  </View>;
}
