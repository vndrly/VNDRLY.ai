import { useFleetCopy } from "@/lib/fleet-copy";
import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetDefinitionSchema, FleetSetupInputSchema, type FleetSetup as Setup, type FleetRoleSchema } from "@workspace/api-zod";
import type { z } from "zod/v4";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import TogglePillButton from "@/components/TogglePillButton";
type Role = z.infer<typeof FleetRoleSchema>;
export default function FleetSetup({ onSaved }: {
    onSaved: () => void;
}) {
    const colors = useColors();
    const copy = useFleetCopy();
    const [setup, setSetup] = useState<Setup | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState("");
    const [certifications, setCertifications] = useState("");
    const [selectedFleet, setSelectedFleet] = useState("");
    const [sites, setSites] = useState<number[]>([]);
    const [memberId, setMemberId] = useState<number | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    useEffect(() => {
        let alive = true;
        void apiFetch<Setup>("/api/fleet/setup").then(value => { if (alive)
            setSetup(value); }).catch(e => { if (alive)
            setError(e instanceof Error ? e.message : "Setup access unavailable."); });
        return () => { alive = false; };
    }, []);
    function addFleet() {
        if (!setup || !name.trim() || sites.length === 0) {
            setError("Name the fleet and choose authorized sites.");
            return;
        }
        const parsed = FleetDefinitionSchema.safeParse({ id: Crypto.randomUUID(), name: name.trim(), siteIds: sites, requiredCertifications: certifications.split(",").map(value => value.trim()).filter(Boolean) });
        if (!parsed.success) {
            setError("Check the fleet name, sites and required certification names.");
            return;
        }
        const fleet = parsed.data;
        setSetup({ ...setup, fleets: [...setup.fleets, fleet] });
        setSelectedFleet(fleet.id);
        setName("");
        setSites([]);
        setError("");
    }
    function setGrant() {
        const fleet = setup?.fleets.find(f => f.id === selectedFleet);
        if (!setup || !fleet || !memberId || roles.length === 0) {
            setError("Choose an existing member, fleet and Fleet roles.");
            return;
        }
        const prior = setup.grants.find(g => g.userId === memberId);
        const grant = { userId: memberId, fleetIds: [...new Set([...(prior?.fleetIds ?? []), fleet.id])], siteIds: [...new Set([...(prior?.siteIds ?? []), ...fleet.siteIds])], roles: [...new Set([...(prior?.roles ?? []), ...roles])], safetyRelease: prior?.safetyRelease ?? false, financeRead: prior?.financeRead ?? false };
        setSetup({ ...setup, grants: [...setup.grants.filter(g => g.userId !== memberId), grant] });
        setError("");
    }
    async function save() {
        if (!setup)
            return;
        const input = FleetSetupInputSchema.safeParse({ expectedVersion: setup.expectedVersion, enabled: setup.enabled, fleets: setup.fleets, grants: setup.grants });
        if (!input.success) {
            setError("Review the fleet configuration before saving.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            await apiFetch("/api/fleet/setup", { method: "POST", body: JSON.stringify(input.data) });
            onSaved();
        }
        catch (e) {
            setError(`${copy(e instanceof Error ? e.message : "Setup save failed.")} ${copy("Reload the saved configuration before editing or retrying.")}`);
            setSetup(null);
        }
        finally {
            setBusy(false);
        }
    }
    return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{copy("Company Fleet setup")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(error)}</Text>}
    {setup && <>
      <Text style={{ color: colors.text }}>{copy("Draft changes are unsaved. Fleet roles grant operational access only; safety release and finance remain separate.")}</Text>
      <TogglePillButton solid={setup.enabled} onPress={() => setSetup({ ...setup, enabled: !setup.enabled })}>{copy(setup.enabled ? "Fleet enabled" : "Fleet disabled")}</TogglePillButton>
      {setup.fleets.map(fleet => <TogglePillButton key={fleet.id} solid={selectedFleet === fleet.id} onPress={() => setSelectedFleet(fleet.id)}>{fleet.name}{copy(" \u00B7 sites ")}{fleet.siteIds.join(", ")}</TogglePillButton>)}
      <TextInput accessibilityLabel={copy("New Fleet name")} placeholder={copy("New fleet name")} value={name} onChangeText={setName} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border }}/>
      <TextInput accessibilityLabel={copy("Required Fleet certifications")} placeholder={copy("Required certification names, separated by commas")} value={certifications} onChangeText={setCertifications} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border }}/>
      {setup.sites.map(site => <TogglePillButton key={site.siteId} solid={sites.includes(site.siteId)} onPress={() => setSites(current => current.includes(site.siteId) ? current.filter(id => id !== site.siteId) : [...current, site.siteId])}>{site.name}</TogglePillButton>)}
      <TogglePillButton onPress={addFleet}>{copy("Add fleet to draft")}</TogglePillButton>
      <Text style={{ color: colors.text }}>{copy("Grant selected fleet access to an existing company member")}</Text>
      {setup.members.map(member => <TogglePillButton key={member.userId} solid={memberId === member.userId} onPress={() => { setMemberId(member.userId); setRoles([]); }}>{member.name}</TogglePillButton>)}
      {(["fleet_manager", "dispatcher", "driver"] as const).map(role => <TogglePillButton key={role} solid={roles.includes(role)} onPress={() => setRoles(current => current.includes(role) ? current.filter(item => item !== role) : [...current, role])}>{copy(role.replaceAll("_", " "))}</TogglePillButton>)}
      <TogglePillButton onPress={setGrant}>{copy("Add grant to draft")}</TogglePillButton>
      <TogglePillButton disabled={!memberId} color="red" onPress={() => setSetup({ ...setup, grants: setup.grants.filter(grant => grant.userId !== memberId) })}>{copy("Remove selected member's Fleet grant from draft")}</TogglePillButton>
      {setup.grants.map(grant => <Text key={grant.userId} style={{ color: colors.text }}>{setup.members.find(m => m.userId === grant.userId)?.name ?? `Member ${grant.userId}`}{copy(": ")}{grant.roles.map(role => copy(role.replaceAll("_", " "))).join(", ")}{copy(" \u00B7 ")}{grant.fleetIds.length}{copy(" fleets \u00B7 ")}{grant.siteIds.length}{copy(" sites")}</Text>)}
      <TogglePillButton disabled={busy} onPress={() => void save()}>{copy("Save Fleet setup")}</TogglePillButton>
    </>}
  </View>;
}
