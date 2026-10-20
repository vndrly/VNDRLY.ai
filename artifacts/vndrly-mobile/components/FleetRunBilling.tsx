import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import type {FleetWorkSession} from "@workspace/api-zod";
export type FleetBillingChoice =
  | {
      mode: "new_ticket";
      workTypeId: number;
      afeNumber: string;
      workDate: string;
    }
  | {
      mode: "existing_ticket";
      workTypeId?:number;
      ticketId: number;
      afeNumber: string;
      workDate: string;
    };
type Options = {
  workTypes: {
    id: number;
    name: string;
    rateCents?: number;
    unit: string|null;
    afeNumber: string;
  }[];
  tickets: {
    id: number;
    ticketNumber: string|number;
    siteId: number;
    afeNumber: string;
    workDate: string;
    planVersion: number;
  }[];
  afeRequired: boolean;
  siteAfe: string;
  referenceFreshness?:"current"|"cached_unverified";
};
export default function FleetRunBilling({
  siteId,
  fleetId,
  onChange,
  disabled,
  workSession,
  authorizedTicketId,
}: {
  siteId?: number;
  fleetId?: string;
  onChange: (choice: FleetBillingChoice | null) => void;
  disabled: boolean;
  workSession?:FleetWorkSession|null;
  /** Dispatch release is bound to the ticket authorized in its saved plan. */
  authorizedTicketId?: number;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope());
  const [workDate, setWorkDate] = useState(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }),
    [afe, setAfe] = useState(""),
    [mode, setMode] = useState<"new_ticket" | "existing_ticket" | null>(null),
    [options, setOptions] = useState<Options | null>(null),
    [workType, setWorkType] = useState<number | null>(null),
    [ticketId, setTicketId] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setWorkType(null);
    setMode(authorizedTicketId ? "existing_ticket" : null);
  }, [siteId, workDate, fleetId, authorizedTicketId]);
  useEffect(() => {
    let alive = true;
    setOptions(null);
    setTicketId(authorizedTicketId ?? null);
    setError("");
    onChange(null);
    if (siteId && /^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      void (workSession&&fleetId?workSession.billingOptions({fleetId,siteId,afeNumber:afe.trim(),workDate}):apiFetch<Options>(
        `/api/fleet/billing-options?siteId=${siteId}&afeNumber=${encodeURIComponent(afe.trim())}&workDate=${workDate}${fleetId ? `&fleetId=${encodeURIComponent(fleetId)}` : ""}`,
        {},
        scope.current,
      ))
        .then((value) => {
          if (alive && isAuthScopeCurrent(scope.current)) {
            if (!afe && value.siteAfe) {
              setAfe(value.siteAfe);
              return;
            }
            setOptions(value);
          }
        })
        .catch((e) => {
          if (alive && isAuthScopeCurrent(scope.current)) setError(e.message);
        });
    }
    return () => {
      alive = false;
    };
  }, [siteId, afe, workDate, fleetId,workSession]);
  useEffect(() => {
    if (!options || !mode || (options.afeRequired && !afe.trim())) {
      onChange(null);
      return;
    }
    if (
      mode === "new_ticket" &&
      options.workTypes.some(
        (w) => w.id === workType && w.afeNumber === afe.trim(),
      )
    )
      onChange({
        mode,
        workTypeId: workType!,
        afeNumber: afe.trim(),
        workDate,
      });
    else if (
      mode === "existing_ticket" &&
      options.tickets.some((t) => t.id === ticketId) && (!authorizedTicketId || ticketId === authorizedTicketId) && (!workSession||options.workTypes.some(w=>w.id===workType&&w.afeNumber===afe.trim()))
    )
      onChange({ mode, ticketId: ticketId!, ...(workSession?{workTypeId:workType!}:{}),afeNumber: afe.trim(), workDate });
    else onChange(null);
  }, [mode, workType, ticketId, options, afe, workDate, authorizedTicketId]);
  const style = {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 12,
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text }}>{copy("Billing for this run")}</Text>
      {!siteId && (
        <Text style={{ color: colors.text }}>
          {copy("Choose the first ordered stop as the billing origin.")}
        </Text>
      )}
      <TextInput
        accessibilityLabel={copy("AFE")}
        placeholder={copy("AFE")}
        value={afe}
        editable={!disabled}
        onChangeText={setAfe}
        style={style}
      />
      <TextInput
        accessibilityLabel={copy("Work date")}
        placeholder="YYYY-MM-DD"
        value={workDate}
        editable={!disabled}
        onChangeText={setWorkDate}
        style={style}
      />
      {(authorizedTicketId ? ["existing_ticket"] as const : ["new_ticket", "existing_ticket"] as const).map((value) => (
        <TogglePillButton
          key={value}
          disabled={disabled || !options}
          solid={mode === value}
          onPress={() => setMode(value)}
        >
          {copy(
            value === "new_ticket"
              ? "Run as new ticket"
              : "Add run to ticket #",
          )}
        </TogglePillButton>
      ))}
      {(mode === "new_ticket"||!!workSession&&mode==="existing_ticket") &&
        options?.workTypes.map((item) => (
          <TogglePillButton
            key={item.id}
            disabled={disabled}
            solid={workType === item.id}
            onPress={() => {
              setWorkType(item.id);
              setAfe(item.afeNumber);
            }}
          >
            {item.name} ·{" "}
            {typeof item.rateCents === "number" &&
            Number.isFinite(item.rateCents)
              ? `$${(item.rateCents / 100).toFixed(2)} / `
              : ""}
            {copy(
              item.unit === "per_hour"
                ? "hour"
                : item.unit === "per_day"
                  ? "day"
                  : workSession?(item.unit?.replaceAll("_"," ")??"Agreement unresolved"):"run",
            )}{" "}
            · AFE: {item.afeNumber || "—"}
          </TogglePillButton>
        ))}
      {options?.referenceFreshness==="cached_unverified"&&<Text style={{color:colors.text}}>{copy("Downloaded choices are unverified; authority is checked again when work synchronizes.")}</Text>}{mode === "existing_ticket" &&
        options?.tickets.filter(item => !authorizedTicketId || item.id === authorizedTicketId).map((item) => (
          <TogglePillButton
            key={item.id}
            disabled={disabled}
            solid={ticketId === item.id}
            onPress={() => setTicketId(item.id)}
          >
            {copy("Ticket #")}
            {item.ticketNumber || item.id} · {item.afeNumber} · {item.workDate}
          </TogglePillButton>
        ))}
      {options?.referenceFreshness==="cached_unverified"&&<Text style={{color:colors.text}}>{copy("Downloaded choices are unverified; authority is checked again when work synchronizes.")}</Text>}{mode === "existing_ticket" && options?.tickets.length === 0 && (
        <Text style={{ color: colors.text }}>
          {copy("No eligible existing tickets are available.")}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
    </View>
  );
}
