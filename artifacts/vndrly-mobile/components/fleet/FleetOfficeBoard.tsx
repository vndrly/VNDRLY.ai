import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetDispatchPlanSchema, FleetDispatchPlanUpdateSchema, type FleetDispatchPlan, type FleetOverview } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useFleetWork } from "@/hooks/use-fleet-work";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import FleetCommercialWork from "@/components/FleetCommercialWork";
import FleetTicketFinalization from "@/components/FleetTicketFinalization";

export default function FleetOfficeBoard() {
  const { user, activeMembershipId, activeMembership } = useAuth();
  const identity = `${user?.id ?? 0}:${activeMembershipId ?? 0}:${activeMembership?.orgId ?? user?.vendorId ?? 0}`;
  return <FleetOfficeBoardContent key={identity} />;
}

function FleetOfficeBoardContent() {
  const colors = useColors(), copy = useFleetCopy();
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false);
  const pending = useRef<ReturnType<typeof FleetDispatchPlanUpdateSchema.parse> | null>(null);
  const [overview, setOverview] = useState<FleetOverview | null>(null), [plans, setPlans] = useState<FleetDispatchPlan[]>([]), [selectedId, setSelectedId] = useState(""), [ticketId, setTicketId] = useState(0), [tickets, setTickets] = useState<{ id: number }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const work = useFleetWork(overview?.accountScope, overview?.runs ?? [], overview?.fleets ?? []);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function read<T>(path: string): Promise<T> {
    const value = await apiFetch<T>(path, {}, scope.current);
    if (!current()) throw Error("Fleet account changed. Reload Office.");
    return value;
  }
  async function load() {
    try {
      const [nextOverview, nextPlans] = await Promise.all([read<FleetOverview>("/api/fleet/overview"), read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans")]);
      if (!current()) return;
      if (nextPlans.plans.some(plan => plan.companyId !== nextOverview.companyId)) throw Error("Office company scope changed.");
      setOverview(nextOverview); setPlans(nextPlans.plans.map(plan => FleetDispatchPlanSchema.parse(plan))); setError("");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Fleet Office unavailable."); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  const selected = plans.find(plan => plan.id === selectedId);
  useEffect(() => {
    setTickets([]); setTicketId(0);
    if (!selected || selected.ticket.kind !== "office_review_draft") return;
    let active = true;
    void read<{ tickets: { id: number }[] }>(`/api/fleet/dispatch-plans/tickets?siteId=${selected.billingSiteId}`)
      .then(value => { if (active && current()) setTickets(value.tickets); })
      .catch(cause => { if (active && current()) setError(cause instanceof Error ? cause.message : "Authorized tickets unavailable."); });
    return () => { active = false; };
  }, [selectedId, selected?.version]);
  async function attachTicket() {
    if (!selected || !ticketId || lock.current) return;
    const exact = pending.current ?? FleetDispatchPlanUpdateSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: selected.version, ticket: { kind: "authorized", ticketId } });
    pending.current = exact; lock.current = true; setBusy(true); setError("");
    try {
      let saved = (await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans")).plans.find(plan => plan.id === selected.id && plan.version > exact.expectedVersion && plan.ticket.kind === "authorized" && plan.ticket.ticketId === ticketId);
      if (!saved) saved = FleetDispatchPlanSchema.parse(await apiFetch(`/api/fleet/dispatch-plans/${selected.id}`, { method: "PATCH", body: JSON.stringify(exact) }, scope.current));
      const canonical = FleetDispatchPlanSchema.parse(saved);
      if (canonical.id !== selected.id || canonical.companyId !== overview?.companyId || canonical.ticket.kind !== "authorized" || canonical.ticket.ticketId !== ticketId) throw Error("Ticket link readback mismatch.");
      const fresh = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      if (!fresh.plans.some(plan => plan.id === selected.id && plan.version >= canonical.version && plan.ticket.kind === "authorized" && plan.ticket.ticketId === ticketId)) throw Error("Ticket link not yet visible. Retry the exact request.");
      if (!current()) return;
      setPlans(fresh.plans.map(plan => FleetDispatchPlanSchema.parse(plan))); pending.current = null;
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Ticket link needs verification."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const text = { color: colors.text }, card = { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 12, padding: 14, gap: 10 } as const;
  return <View style={{ gap: 12 }}>
    <View style={card}><Text style={{ ...text, fontWeight: "700" }}>{copy("Fleet Office")}</Text>
      <Text style={text}>{copy("Review work authorization, operational closeout, charges, and ticket finalization.")}</Text>
      {plans.map(plan => <TogglePillButton key={plan.id} onPress={() => setSelectedId(plan.id)}>{plan.title} · {plan.ticket.kind === "authorized" ? `Ticket #${plan.ticket.ticketId}` : copy("Office-review draft")}</TogglePillButton>)}
      {selected?.ticket.kind === "authorized" && <Text style={text}>Ticket #{selected.ticket.ticketId} · {copy(selected.state)}</Text>}
      {selected?.ticket.kind === "office_review_draft" && <View style={{ gap: 8 }}><Text style={text}>{copy("This draft is non-billable until authorized work is attached.")}</Text>
        <FleetChoiceField label={copy("Authorized ticket")} value={String(ticketId || "")} options={tickets.map(ticket => ({ id: String(ticket.id), label: `Ticket #${ticket.id}` }))} onChange={value => setTicketId(Number(value))} disabled={busy} />
        <TogglePillButton disabled={busy || !ticketId} onPress={() => void attachTicket()}>{copy(pending.current ? "Verify and retry exact ticket link" : "Attach authorized ticket")}</TogglePillButton></View>}
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
      <TogglePillButton disabled={busy} onPress={() => void load()}>{copy("Refresh Fleet Office")}</TogglePillButton>
    </View>
    {(overview?.runs ?? []).filter(run => run.status === "submitted_for_review" || run.status === "completed").map(run => <View key={run.id} style={card}>
      <Text style={text}>{run.title} · {copy(run.status)} · {run.linkedTicketId ? `Ticket #${run.linkedTicketId}` : copy("No linked ticket")}</Text>
      {run.billingV2 && work.session && <FleetCommercialWork session={work.session} run={run} pending={false} onChanged={() => void load()} />}
      {!run.billingV2 && run.linkedTicketId && <FleetTicketFinalization ticketId={run.linkedTicketId} onChanged={() => void load()} />}
    </View>)}
  </View>;
}
