import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { FleetHomeProjection, FleetOverview } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import EmployeeCertificationsPanel from "@/components/EmployeeCertificationsPanel";

type Employee = { id: number; vendorId: number; firstName: string; lastName: string; email: string; phone: string | null; jobTitle: string | null; userId?: number | null; isActive: boolean };
type Cert = { id: number; name: string; expirationDate: string | null };
type DriverRow = Employee & { available: boolean; cdl: "green" | "amber" | "red"; cdlLabel: string };

function cdlState(certs: Cert[]) {
  const cdl = certs.find(cert => /\b(cdl|commercial driver)/i.test(cert.name));
  if (!cdl) return { cdl: "red" as const, cdlLabel: "CDL record missing" };
  if (!cdl.expirationDate) return { cdl: "amber" as const, cdlLabel: "CDL expiration not recorded" };
  const days = (new Date(`${cdl.expirationDate}T23:59:59`).getTime() - Date.now()) / 86400000;
  return days < 0 ? { cdl: "red" as const, cdlLabel: `CDL expired ${cdl.expirationDate}` } : days <= 60 ? { cdl: "amber" as const, cdlLabel: `CDL expires ${cdl.expirationDate}` } : { cdl: "green" as const, cdlLabel: `CDL current through ${cdl.expirationDate}` };
}

export default function FleetDrivers({ initialDriverUserId }: { initialDriverUserId?: number }) {
  const colors = useColors(), copy = useFleetCopy(), { user, activeMembership } = useAuth();
  const companyId = activeMembership?.orgId ?? user?.vendorId ?? 0;
  const [rows, setRows] = useState<DriverRow[]>([]), [overview, setOverview] = useState<FleetOverview | null>(null), [selectedUserId, setSelectedUserId] = useState(initialDriverUserId ?? 0);
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [firstName, setFirstName] = useState(""), [lastName, setLastName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const [employees, home, nextOverview] = await Promise.all([
        apiFetch<Employee[]>("/api/field-employees?includeInactive=true"),
        apiFetch<{ data?: FleetHomeProjection }>("/api/fleet/home?module=summary"),
        apiFetch<FleetOverview>("/api/fleet/overview"),
      ]);
      const driverStates = new Map((home.data?.previews?.drivers ?? []).map(driver => [driver.userId, driver.status]));
      const candidates = employees.filter(employee => employee.userId && driverStates.has(employee.userId));
      const certs = await Promise.all(candidates.map(employee => apiFetch<Cert[]>(`/api/field-employees/${employee.id}/certifications`).catch(() => [])));
      setRows(candidates.map((employee, index) => ({ ...employee, available: driverStates.get(employee.userId!) === "available", ...cdlState(certs[index]) })));
      setOverview(nextOverview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy("Drivers unavailable")); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [companyId]);
  const selected = rows.find(row => row.userId === selectedUserId);
  const history = useMemo(() => overview?.runs.filter(run => run.driverUserId === selectedUserId).slice(0, 20) ?? [], [overview, selectedUserId]);
  async function addDriver() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) { setError(copy("First name, last name, and email are required.")); return; }
    setBusy(true); setError("");
    try {
      await apiFetch("/api/field-employees", { method: "POST", body: JSON.stringify({ vendorId: companyId, vendorRole: "field", jobTitle: "Fleet Driver", firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim() || null, pecCertification: false, pecExpirationDate: null, roles: ["fleet_driver"] }) });
      setAdding(false); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy("Driver could not be added.")); setBusy(false); }
  }
  const card = { backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 9, padding: 16 } as const;
  const field = { borderColor: colors.border, borderWidth: 1, color: colors.text, padding: 11 } as const;
  if (selected) return <View style={{ gap: 14 }}>
    <TogglePillButton color="blue" onPress={() => setSelectedUserId(0)}>{copy("All Drivers")}</TogglePillButton>
    <View style={card}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{selected.firstName} {selected.lastName}</Text><Text style={{ color: colors.mutedForeground }}>{selected.jobTitle ?? copy("Fleet Driver")} · {selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</Text><Text style={{ color: selected.available ? "#16a34a" : colors.mutedForeground, fontWeight: "700" }}>{copy(selected.available ? "Available" : "Unavailable")}</Text><Text style={{ color: selected.cdl === "green" ? "#16a34a" : selected.cdl === "amber" ? "#d97706" : colors.destructive, fontWeight: "700" }}>{copy(selected.cdlLabel)}</Text></View>
    <EmployeeCertificationsPanel employeeId={selected.id} defaultCertificationName="CDL" onChanged={() => void load()} />
    <View style={card}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("Recent work history")}</Text>{history.length ? history.map(run => <Text key={run.id} numberOfLines={2} style={{ color: colors.text }}>{run.linkedTicketId ? `Ticket #${run.linkedTicketId} · ` : ""}{run.title} · {copy(run.status.replaceAll("_", " "))}</Text>) : <Text style={{ color: colors.mutedForeground }}>{copy("No recent Fleet runs")}</Text>}</View>
  </View>;
  return <View style={{ gap: 14 }}>
    <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between" }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy("Drivers")}</Text><TogglePillButton color="blue" onPress={() => setAdding(value => !value)}>{copy("Add New Driver")}</TogglePillButton></View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {adding && <View style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Add New Driver")}</Text><Text style={{ color: colors.mutedForeground }}>{copy("Create the employee record, then finish login and Fleet access in Fleet Setup.")}</Text><TextInput accessibilityLabel={copy("First name")} placeholder={copy("First name")} placeholderTextColor={colors.mutedForeground} value={firstName} onChangeText={setFirstName} style={field} /><TextInput accessibilityLabel={copy("Last name")} placeholder={copy("Last name")} placeholderTextColor={colors.mutedForeground} value={lastName} onChangeText={setLastName} style={field} /><TextInput accessibilityLabel={copy("Email")} placeholder={copy("Email")} placeholderTextColor={colors.mutedForeground} autoCapitalize="none" value={email} onChangeText={setEmail} style={field} /><TextInput accessibilityLabel={copy("Phone")} placeholder={copy("Phone")} placeholderTextColor={colors.mutedForeground} value={phone} onChangeText={setPhone} style={field} /><TogglePillButton color="blue" disabled={busy} onPress={() => void addDriver()}>{copy("Save New Driver")}</TogglePillButton></View>}
    {busy && !rows.length ? <Text style={{ color: colors.mutedForeground }}>{copy("Loading Drivers")}</Text> : rows.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={copy(`Open ${row.firstName} ${row.lastName}`)} onPress={() => setSelectedUserId(row.userId!)} style={({ pressed }) => ({ ...card, opacity: pressed ? .7 : 1 })}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{row.firstName} {row.lastName}</Text><Text numberOfLines={1} style={{ color: colors.mutedForeground }}>{copy(row.available ? "Available" : "Unavailable")} · <Text style={{ color: row.cdl === "green" ? "#16a34a" : row.cdl === "amber" ? "#d97706" : colors.destructive }}>{copy(row.cdlLabel)}</Text></Text></Pressable>)}
  </View>;
}
