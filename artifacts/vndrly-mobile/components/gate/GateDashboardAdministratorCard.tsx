import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { apiFetch } from "@/lib/api";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import GateDashboardProfitabilityDemo from "./GateDashboardProfitabilityDemo";
import { gateGoDemoCosts } from "./gate-demo-costs";

type Ticket = {
  id: number;
  estimate?: { risk: "low" | "moderate" | "high"; equipment: { kind: "purchase" | "rental"; description: string; cents: number }[] } | null;
  revenueByDay?: { day: string; chargeCents: number }[];
  group: "unstarted" | "open" | "closed";
  tone: "white" | "blue" | "amber" | "red" | "green";
  status: string;
  invoiceCents: number;
  quarterCents: number;
  yearToDateCents: number;
  payrollCents: number | null;
  quarterPayrollCents: number;
  yearToDatePayrollCents: number;
  daysSinceBilled: number;
  siteName: string;
  gateName: string | null;
  stationId: string | null;
};
type Group = Ticket["group"];
type Action = "start" | "invoice" | "end" | "review" | "estimate" | "amend";

const groups: Group[] = ["unstarted", "open", "closed"];
const tones = { white: "#ececec", blue: "#7dd3fc", amber: "#fbbf24", red: "#fca5a5", green: "#86efac" };

export default function GateDashboardAdministratorCard({ height, gateGoDemo = false, onAction }: {
  height: number;
  gateGoDemo?: boolean;
  onAction: (action: { type: "profitability" } | { type: "group"; group: Group } | { type: "ticket-profitability"; ticketId: number } | { type: "ticket"; ticketId: number; action: Action }) => void;
}) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState(false);
  const [profitOpen, setProfitOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Group[]>([]);
  const [openProfit, setOpenProfit] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => void apiFetch<Ticket[]>("/api/gate-billing/tickets").then(rows => {
      if (active) { setTickets(rows); setError(false); }
    }, () => { if (active) setError(true); });
    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const money = (cents: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" }).format(cents / 100);
  const compact = (cents: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
  const totals = useMemo(() => ({
    quarter: tickets?.reduce((sum, row) => sum + (row.quarterCents ?? 0), 0) ?? 0,
    quarterPayroll: tickets?.reduce((sum, row) => sum + (row.quarterPayrollCents ?? 0), 0) ?? 0,
    year: tickets?.reduce((sum, row) => sum + (row.yearToDateCents ?? 0), 0) ?? 0,
    yearPayroll: tickets?.reduce((sum, row) => sum + (row.yearToDatePayrollCents ?? 0), 0) ?? 0,
  }), [tickets]);
  const detail = (label: string, value: string, color = "#ececec") => <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 3 }}><Text style={{ color: "#b3b3b3", fontSize: 12, flex: 1 }}>{label}</Text><Text style={{ color, fontSize: 12 }}>{value}</Text></View>;
  const disclosure = (label: string, open: boolean, press: () => void, value?: string) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={press} style={{ minHeight: 38, borderColor: primary, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", marginTop: 8 }}><Text style={{ color: "#ececec", fontSize: 13, fontWeight: "600", flex: 1 }}>{label}</Text>{value && <Text style={{ color: "#ececec", fontSize: 11 }}>{value}</Text>}<Feather name={open ? "chevron-down" : "chevron-right"} size={16} color="#a3a3a3" /></Pressable>;
  const toggleGroup = (group: Group) => { setOpenGroups(current => current.includes(group) ? current.filter(item => item !== group) : [...current, group]); onAction({ type: "group", group }); };
  const ticketAction = (ticketId: number, action: Action, label: string, enabled = true) => <Pressable key={action} accessibilityRole="button" accessibilityLabel={`${label} ${formatTicketTrackingNumber(ticketId)}`} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => onAction({ type: "ticket", ticketId, action })} style={{ paddingVertical: 6, paddingRight: 14 }}><Text style={{ color: enabled ? primary : "#a3a3a3", fontSize: 12 }}>{label}</Text></Pressable>;
  return <View accessibilityLabel={es ? "Controles del administrador" : "Administrator Controls"} style={{ height, backgroundColor: "#242426", borderWidth: 2, borderColor: primary, borderRadius: 14, overflow: "hidden" }}>
    <ScrollView nestedScrollEnabled contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, borderBottomColor: "#3a3a3a", borderBottomWidth: 1 }}><Feather name="shield" size={20} color={primary} /><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{es ? "Controles del administrador" : "Administrator Controls"}</Text></View>
      {error && <Text accessibilityRole="alert" style={{ color: "#fca5a5", paddingTop: 8 }}>{es ? "No se pudieron cargar los tickets de facturación." : "Could not load billing tickets."}</Text>}
      {!tickets && !error && <Text style={{ color: "#b3b3b3", paddingTop: 8 }}>{es ? "Cargando…" : "Working…"}</Text>}
      {tickets && <>
        <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700", paddingTop: 12 }}>{es ? "Entradas y salidas de dinero por tickets" : "Ticketed Money Inflow/Outflow"}</Text>
        {gateGoDemo ? <GateDashboardProfitabilityDemo tickets={tickets} money={money} open={profitOpen} onToggle={() => {setProfitOpen(!profitOpen);onAction({type:"profitability"});}} /> : <>{disclosure(es ? "Rentabilidad estimada" : "Estimated Profitability", profitOpen, () => { setProfitOpen(!profitOpen); onAction({ type: "profitability" }); })}{profitOpen && <View style={{ paddingHorizontal: 8, paddingTop: 8 }}>{detail(es ? "Este trimestre" : "This Quarter", money(totals.quarter), "#86efac")}{detail(es ? "Nómina acumulada" : "Accrued payroll", money(-totals.quarterPayroll), "#fca5a5")}{detail(es ? "Año hasta la fecha" : "Year to Date", money(totals.year), "#86efac")}{detail(es ? "Nómina acumulada" : "Accrued payroll", money(-totals.yearPayroll), "#fca5a5")}</View>}</>}
        <View style={{ marginTop: 12, borderWidth: 1, borderColor: primary, borderRadius: 14, paddingHorizontal: 12, paddingBottom: 12 }}>
          <Text style={{ color: "#ececec", fontWeight: "700", fontSize: 14, paddingTop: 12 }}>{es ? "Tickets recientes" : "Recent Tickets"}</Text>
          <Text style={{ color: "#b3b3b3", fontSize: 11, paddingTop: 2 }}>{es ? "Facturación de toda la empresa · todos los sitios" : "Company-wide billing · all sites"}</Text>
          {groups.map(group => {
            const rows = tickets.filter(row => row.group === group);
            const total = rows.reduce((sum, row) => sum + row.invoiceCents, 0);
            const paid = rows.reduce((sum, row) => sum + (row.status === "funds_dispersed" ? row.invoiceCents : 0), 0);
            const label = group === "unstarted" ? (es ? `Tienes ${rows.length} tickets esperando comenzar` : `You have ${rows.length} ${rows.length === 1 ? "ticket" : "tickets"} waiting to start`) : group === "open" ? (es ? `Tienes ${rows.length} tickets abiertos` : `You have ${rows.length} ${rows.length === 1 ? "ticket" : "tickets"} open`) : (es ? `Tienes ${rows.length} tickets cerrados` : `You have ${rows.length} ${rows.length === 1 ? "ticket" : "tickets"} closed`);
            const value = group === "open" ? money(total) : group === "closed" ? `${compact(paid)}/${compact(total - paid)}/${total > 0 ? Math.round(100 * paid / total) : 0}% paid` : undefined;
            return <View key={group}>{disclosure(label, openGroups.includes(group), () => toggleGroup(group), value)}
              {openGroups.includes(group) && rows.map(ticket => {
                const demo = gateGoDemo && !ticket.estimate ? gateGoDemoCosts(ticket) : null;
                const payroll = demo?.wages ?? ticket.payrollCents;
                const estimate = ticket.estimate && ticket.payrollCents != null ? (() => {
                  const purchases = ticket.estimate!.equipment.reduce((sum, item) => sum + (item.kind === "purchase" ? item.cents : 0), 0);
                  const rentals = ticket.estimate!.equipment.reduce((sum, item) => sum + (item.kind === "rental" ? item.cents : 0), 0);
                  const operating = ticket.invoiceCents - ticket.payrollCents! - purchases - rentals;
                  const reserve = Math.round(Math.max(0, operating + purchases) * { low: 0.25, moderate: 0.21, high: 0.17 }[ticket.estimate!.risk]);
                  return { purchases, rentals, operating, reserve, afterTax: operating - reserve };
                })() : null;
                const actionable = !["funds_dispersed", "cancelled", "denied"].includes(ticket.status);
                return <View key={ticket.id} style={{ borderBottomColor: "#3a3a3a", borderBottomWidth: 1, paddingVertical: 10, paddingHorizontal: 3 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Pressable disabled={group !== "open"} accessibilityRole={group === "open" ? "button" : undefined} onPress={() => onAction({ type: "ticket", ticketId: ticket.id, action: "estimate" })}><Text style={{ color: tones[ticket.tone], fontWeight: "700", fontSize: 13 }}>{formatTicketTrackingNumber(ticket.id)}</Text></Pressable><Text style={{ color: ticket.status === "funds_dispersed" ? "#86efac" : "#a3a3a3", fontSize: 11 }}>{ticket.status === "funds_dispersed" ? "PAID" : "UNPAID"}</Text></View>
                <Text style={{ color: "#b3b3b3", fontSize: 11 }}>{[ticket.siteName, ticket.gateName].filter(Boolean).join(" · ")} · {ticket.daysSinceBilled} days since last billed</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{group === "closed" ? <>{ticketAction(ticket.id, "review", "Review")}{ticket.status === "kicked_back" && ticketAction(ticket.id, "amend", "Amend")}</> : <>{ticketAction(ticket.id, "start", "Start Ticket", actionable && group === "unstarted" && Boolean(ticket.stationId))}{ticketAction(ticket.id, "invoice", "Invoice Now", actionable && group === "open")}{ticketAction(ticket.id, "end", "Close Ticket", actionable && group === "open")}</>}</View>
                {group !== "unstarted" && <>{disclosure("Estimated Profitability", openProfit.includes(ticket.id), () => { setOpenProfit(current => current.includes(ticket.id) ? current.filter(id => id !== ticket.id) : [...current, ticket.id]); onAction({ type: "ticket-profitability", ticketId: ticket.id }); })}{openProfit.includes(ticket.id) && <View style={{ padding: 8 }}>{detail("Invoice amount", money(ticket.invoiceCents))}{detail("Accrued payroll", payroll == null ? "—" : money(-payroll), "#fca5a5")}{estimate && <>{detail("Equipment purchases", money(-estimate.purchases), "#fca5a5")}{detail("Equipment rentals", money(-estimate.rentals), "#fca5a5")}{detail("Estimated tax reserve", money(-estimate.reserve), "#fca5a5")}{detail("Estimated after-tax profit", money(estimate.afterTax))}</>}{demo && <>{detail("Employer payroll taxes (demo)", money(-demo.employerTaxes), "#fca5a5")}{detail("Purchases & Rentals (demo)", money(-demo.equipment), "#fca5a5")}{demo.items.map(([kind,name,cents])=>detail(`${kind} · ${name}`,money(cents),"#b3b3b3"))}</>}{detail("Estimated profit", payroll == null ? "—" : (() => { const profit = estimate?.operating ?? demo?.profit ?? ticket.invoiceCents - payroll; return `${money(profit)}${ticket.invoiceCents > 0 ? ` (${new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 }).format(profit / ticket.invoiceCents)})` : ""}`; })())}{demo && <>{detail("Federal tax reserve (demo)",money(-demo.reserve),"#fca5a5")}{detail("Profit after reserve",money(demo.profit-demo.reserve))}</>}</View>}</>}
              </View>})}</View>;
          })}
        </View>
      </>}
    </ScrollView>
  </View>;
}
