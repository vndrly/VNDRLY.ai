import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import type {
  FleetTicketPlan as Plan,
  FleetDestination,
} from "@workspace/api-zod";
import TogglePillButton from "./TogglePillButton";
import {
  useCommercialScope,
  type CommercialContext,
} from "./FleetDestinationDirectory";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
type Recommendation = {
  destination: FleetDestination;
  distanceMiles: number | null;
  durationMinutes: number | null;
  basis: "driving" | "straight_line" | "unavailable";
  availability: "capacity_unconfirmed";
  materialEligibility: "matched" | "unconfirmed";
};
type Read = {
  ticketId: number;
  siteId: number;
  partnerId: number;
  plan: Plan | null;
  charges: { runs: number; total: number | string };
  canManage: boolean;
};
export default function FleetTicketPlan(props: {
  ticketId: number;
  onChanged?: () => void;
}) {
  const scope = useCommercialScope();
  return <TicketPlan key={`${scope}:${props.ticketId}`} {...props} />;
}
function TicketPlan({
  ticketId,
  onChanged,
}: {
  ticketId: number;
  onChanged?: () => void;
}) {
  const [confirmClose,setConfirmClose]=useState(false);
  const colors = useColors(),
    alive = useRef(true),
    lock = useRef(false),
    scope = useRef(captureAuthScope());
  const [data, setData] = useState<Read | null>(null),
    [context, setContext] = useState<CommercialContext | null>(null),
    [mode, setMode] = useState<"batch" | "singles">("singles"),
    [rate, setRate] = useState(""),
    [closure, setClosure] = useState<"shift" | "day" | "manual">("manual"),
    [date, setDate] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [attempt, setAttempt] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [material, setMaterial] = useState(""),
    [recommendations, setRecommendations] = useState<Recommendation[]>([]),
    [recommendBusy, setRecommendBusy] = useState(false);
  const recommendSequence = useRef(0);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function recommend() {
    if (!data || attempt || recommendBusy) return;
    const sequence = ++recommendSequence.current;
    setRecommendBusy(true);
    setRecommendations([]);
    try {
      const result = await apiFetch<{ recommendations: Recommendation[] }>(
        `/api/fleet/destinations/recommend?siteId=${data.siteId}${material.trim() ? `&material=${encodeURIComponent(material.trim())}` : ""}`,
        {},
        scope.current,
      );
      if (current() && sequence === recommendSequence.current)
        setRecommendations(
          result.recommendations.filter(
            (r) =>
              r.destination.active &&
              context?.destinations.some(
                (d) => d.id === r.destination.id && d.active,
              ),
          ),
        );
    } catch (e) {
      if (current() && sequence === recommendSequence.current)
        setError((e as Error).message);
    } finally {
      if (current() && sequence === recommendSequence.current)
        setRecommendBusy(false);
    }
  }
  async function load() {
    try {
      const result: Read = await apiFetch(
        `/api/fleet/tickets/${ticketId}/plan`,
        {},
        scope.current,
      );
      if (result.ticketId !== ticketId)
        throw new Error("Ticket scope could not be verified.");
      const settings: CommercialContext = await apiFetch(
        `/api/fleet/commercial?siteId=${result.siteId}`,
        {},
        scope.current,
      );
      if (current()) {
        setData(result);
        setContext(settings);
        setMode(settings.sitePolicy?.mode ?? settings.defaultMode);
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  function review() {
    setError("");
    if (!/^\d+(\.\d{1,2})?$/.test(rate) || Number(rate) > 1000000) {
      setError("Enter a valid dollars per run amount.");
      return;
    }
    if (!ids.length) {
      setError("Select at least one approved destination.");
      return;
    }
    let closesAt: string | null = null;
    if (closure !== "manual") {
      const parsed = new Date(date);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.getTime() <= Date.now()
      ) {
        setError("Enter a future closure date and time (YYYY-MM-DDTHH:mm).");
        return;
      }
      closesAt = parsed.toISOString();
    }
    setAttempt({
      operationId: Crypto.randomUUID(),
      expectedVersion: 0,
      mode: context?.sitePolicy?.mode ?? mode,
      rateCents: Math.round(Number(rate) * 100),
      closure,
      closesAt,
      destinationIds: [...ids],
    });
  }
  async function save() {
    if (lock.current || !attempt || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        `/api/fleet/tickets/${ticketId}/plan`,
        { method: "POST", body: JSON.stringify(attempt) },
        scope.current,
      );
      if (current()) {
        await load();
        setAttempt(null);
        onChanged?.();
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  async function closePlan(){if(lock.current||!data?.plan||!current())return;lock.current=true;setBusy(true);setError("");try{await apiFetch(`/api/fleet/tickets/${ticketId}/plan/close`,{method:"POST",body:JSON.stringify({expectedVersion:data.plan.version})},scope.current);if(current()){setConfirmClose(false);await load();onChanged?.();}}catch(e){if(current())setError((e as Error).message);}finally{lock.current=false;if(current())setBusy(false);}}
  const inputStyle = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
  };
  if (!data || !context)
    return (
      <View>
        <Text>{error || "Loading ticket plan…"}</Text>
      </View>
    );
  const site = context.sites.find((s) => s.siteId === data.siteId);
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>
        Ticket commercial plan
      </Text>
      <Text style={{ color: colors.text }}>
        Origin: {site?.name ?? `Site ${data.siteId}`} (locked)
      </Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {data.plan ? (
        <>
          {data.plan.closedAt?<Text style={{color:colors.text}}>Closed to new runs · {new Date(data.plan.closedAt).toLocaleString()}</Text>:data.canManage&&<View style={{gap:8}}>{confirmClose?<><Text style={{color:colors.text}}>Close this ticket to new runs? Existing runs can finish and be reviewed. This does not approve or pay the ticket.</Text><TogglePillButton compactOnTablet disabled={busy} onPress={()=>void closePlan()}>Confirm close to new runs</TogglePillButton><TogglePillButton compactOnTablet disabled={busy} onPress={()=>setConfirmClose(false)}>Keep open</TogglePillButton></>:<TogglePillButton compactOnTablet onPress={()=>setConfirmClose(true)}>Close to new runs</TogglePillButton>}</View>}
          <Text style={{ color: colors.text }}>
            {data.plan.mode} · ${(data.plan.rateCents / 100).toFixed(2)} / run ·{" "}
            {data.plan.closure}
            {data.plan.closesAt
              ? ` · ${new Date(data.plan.closesAt).toLocaleString()}`
              : ""}
          </Text>
          {data.plan.destinations.map((d) => (
            <Text key={d.id} style={{ color: colors.text }}>
              Approved: {d.name} · {d.address}
            </Text>
          ))}
          <Text style={{ color: colors.text }}>
            Accepted runs: {data.charges.runs} · Total: $
            {Number(data.charges.total).toFixed(2)}
          </Text>
          <Text style={{ color: colors.text }}>
            This plan is frozen for this ticket.
          </Text>
        </>
      ) : data.canManage ? (
        <>
          {context.sitePolicy?.mode ? (
            <Text style={{ color: colors.text }}>
              Partner override: {context.sitePolicy.mode}
            </Text>
          ) : (
            <View style={{ gap: 8 }}>
              {(["batch", "singles"] as const).map((value) => (
                <TogglePillButton
                  key={value}
                  compactOnTablet
                  disabled={!!attempt}
                  onPress={() => setMode(value)}
                >
                  {mode === value ? "✓ " : ""}
                  {value === "batch" ? "Batch" : "Singles"}
                </TogglePillButton>
              ))}
            </View>
          )}
          <TextInput
            accessibilityLabel="Dollars per run"
            placeholder="Dollars per run"
            keyboardType="decimal-pad"
            value={rate}
            onChangeText={setRate}
            editable={!attempt}
            style={inputStyle}
          />
          {(["shift", "day", "manual"] as const).map((value) => (
            <TogglePillButton
              key={value}
              compactOnTablet
              disabled={!!attempt}
              onPress={() => setClosure(value)}
            >
              {closure === value ? "✓ " : ""}Close {value}
            </TogglePillButton>
          ))}
          {closure !== "manual" ? (
            <TextInput
              accessibilityLabel="Closure date and time"
              placeholder="YYYY-MM-DDTHH:mm (local time)"
              value={date}
              onChangeText={setDate}
              editable={!attempt}
              style={inputStyle}
            />
          ) : null}
          <Text style={{ color: colors.text }}>Destination suggestions</Text>
          <TextInput
            accessibilityLabel="Material for destination suggestions"
            placeholder="Material (optional)"
            value={material}
            editable={!attempt && !recommendBusy}
            onChangeText={(value) => {
              setMaterial(value);
              setRecommendations([]);
            }}
            style={inputStyle}
          />
          <TogglePillButton
            compactOnTablet
            disabled={!!attempt || recommendBusy}
            loading={recommendBusy}
            onPress={() => void recommend()}
          >
            Find destination suggestions
          </TogglePillButton>
          {recommendations.map((r, index) => (
            <View key={r.destination.id} style={{ gap: 4 }}>
              <Text style={{ color: colors.text }}>
                {index + 1}. {r.destination.name} ·{" "}
                {r.basis === "driving"
                  ? "Driving distance"
                  : r.basis === "straight_line"
                    ? "Straight-line distance"
                    : "Distance unavailable"}
                {r.distanceMiles !== null
                  ? `: ${r.distanceMiles.toFixed(1)} mi`
                  : ""}
                {r.basis === "driving" && r.durationMinutes !== null
                  ? ` · ${Math.round(r.durationMinutes)} min`
                  : ""}
              </Text>
              <Text style={{ color: colors.text }}>
                Capacity unconfirmed ·{" "}
                {r.materialEligibility === "matched"
                  ? "Material matched"
                  : "Material eligibility unconfirmed"}{" "}
                · {r.destination.hours || "Hours unconfirmed"}
              </Text>
              <TogglePillButton
                compactOnTablet
                disabled={!!attempt}
                onPress={() =>
                  setIds(
                    ids.includes(r.destination.id)
                      ? ids.filter((id) => id !== r.destination.id)
                      : [...ids, r.destination.id],
                  )
                }
              >
                {ids.includes(r.destination.id)
                  ? "Remove approval: "
                  : "Approve suggestion: "}
                {r.destination.name}
              </TogglePillButton>
            </View>
          ))}
          <Text style={{ color: colors.text }}>Approved destinations</Text>
          {context.destinations
            .filter((d) => d.active)
            .map((d) => (
              <TogglePillButton
                key={d.id}
                compactOnTablet
                disabled={!!attempt}
                onPress={() =>
                  setIds(
                    ids.includes(d.id)
                      ? ids.filter((id) => id !== d.id)
                      : [...ids, d.id],
                  )
                }
              >
                {ids.includes(d.id) ? "✓ " : ""}
                {d.name}
              </TogglePillButton>
            ))}
          {attempt ? (
            <>
              <Text style={{ color: colors.text }}>
                Review: {attempt.mode} · ${(attempt.rateCents / 100).toFixed(2)}{" "}
                / run · Close {attempt.closure}
                {attempt.closesAt
                  ? ` at ${new Date(attempt.closesAt).toLocaleString()}`
                  : ""}{" "}
                ·{" "}
                {context.destinations
                  .filter((d) => attempt.destinationIds.includes(d.id))
                  .map((d) => d.name)
                  .join(", ")}
              </Text>
              <TogglePillButton
                compactOnTablet
                loading={busy}
                disabled={busy}
                onPress={() => void save()}
              >
                Confirm ticket plan
              </TogglePillButton>
            </>
          ) : (
            <TogglePillButton compactOnTablet onPress={review}>
              Review ticket plan
            </TogglePillButton>
          )}
        </>
      ) : (
        <Text style={{ color: colors.text }}>
          Your company administrator configures this ticket.
        </Text>
      )}
    </View>
  );
}
