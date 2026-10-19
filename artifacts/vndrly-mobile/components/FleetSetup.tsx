import FleetProfileEditor from "@/components/FleetProfileEditor";
import FleetCheckbox from "@/components/FleetCheckbox";
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
        if (!setup || !name.trim()) {
            setError("Name the resource pool.");
            return;
        }
        const parsed = FleetDefinitionSchema.safeParse({ id: Crypto.randomUUID(), name: name.trim(), siteIds: sites, requiredCertifications: certifications.split(",").map(value => value.trim()).filter(Boolean) });
        if (!parsed.success) {
            setError("Check the resource pool name and certification names.");
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
            setError("Choose an existing member, resource pool and Fleet Ops roles.");
            return;
        }
        const prior = setup.grants.find(g => g.userId === memberId);
        const combinedRoles=[...new Set([...(prior?.roles??[]),...roles])];
        const grant = { userId: memberId, fleetIds: [...new Set([...(prior?.fleetIds ?? []), fleet.id])], siteIds: combinedRoles.some(role=>["fleet_manager","dispatcher"].includes(role))?[...new Set([...(prior?.siteIds ?? []), ...fleet.siteIds])]:[], roles: combinedRoles, safetyRelease: prior?.safetyRelease ?? false, financeRead: prior?.financeRead ?? false };
        setSetup({ ...setup, grants: [...setup.grants.filter(g => g.userId !== memberId), grant] });
        setError("");
    }
    async function save() {
        if (!setup)
            return;
        const input = FleetSetupInputSchema.safeParse({ expectedVersion: setup.expectedVersion, enabled: setup.enabled, fleets: setup.fleets, grants: setup.grants.map(grant=>grant.roles.some(role=>["fleet_manager","dispatcher"].includes(role))?grant:{...grant,siteIds:[]}), ...(setup.supportGrants ? { supportGrants: setup.supportGrants } : {}) });
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
    <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{copy("Fleet access settings")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(error)}</Text>}
    {setup && <>
      <Text style={{ color: colors.text }}>{copy("Draft changes are unsaved. Fleet roles grant operational access only; safety release and finance remain separate.")}</Text>
      <Text style={{color:colors.text}}>{copy("Build truck/rig/driver Details in Inventory and Details. These settings control company resource access and office dispatch permissions; drivers do not need site assignments.")}</Text>
      <FleetCheckbox label={copy("Enable Fleet Ops")} disabled={busy} checked={setup.enabled} onChange={enabled => setSetup({ ...setup, enabled })} />
      {setup.fleets.map(fleet => <TogglePillButton compactOnTablet key={fleet.id} disabled={busy} solid={selectedFleet === fleet.id} onPress={() => setSelectedFleet(fleet.id)}>{`${fleet.name}${copy(" \u00B7 sites ")}${fleet.siteIds.join(", ")}`}</TogglePillButton>)}
      {setup.fleets.filter(fleet => fleet.id === selectedFleet).map(fleet => <View key={`detail:${fleet.id}`} style={{ gap: 8, backgroundColor: colors.card, padding: 16, borderRadius: 14 }}>
        <TextInput accessibilityLabel={copy("Resource pool name")} editable={!busy} value={fleet.name} onChangeText={value => setSetup({ ...setup, fleets: setup.fleets.map(item => item.id === fleet.id ? { ...item, name: value } : item) })} style={{ color: colors.text, padding: 12, borderColor: colors.border, borderWidth: 1 }} />
        <Text style={{ color: colors.text }}>{copy("Pool assets")}</Text>
        {(setup.equipment ?? []).map(asset => <FleetCheckbox key={asset.assetId} label={asset.name} disabled={busy} checked={fleet.equipmentAssetIds?.includes(asset.assetId) ?? false} onChange={checked => setSetup({ ...setup, fleets: setup.fleets.map(item => item.id === fleet.id ? { ...item, equipmentAssetIds: checked ? [...(item.equipmentAssetIds ?? []), asset.assetId] : (item.equipmentAssetIds ?? []).filter(id => id !== asset.assetId) } : item) })} />)}
        <Text style={{ color: colors.text }}>{copy("Authorized billing sites")}</Text>
        {setup.sites.map(site => <FleetCheckbox key={site.siteId} label={site.name} disabled={busy} checked={fleet.siteIds.includes(site.siteId)} onChange={checked => {
          const fleets = setup.fleets.map(item => item.id === fleet.id ? { ...item, siteIds: checked ? [...item.siteIds, site.siteId] : item.siteIds.filter(id => id !== site.siteId) } : item);
          setSetup({ ...setup, fleets, grants: setup.grants.map(grant => ({ ...grant, siteIds: grant.siteIds.filter(id => fleets.some(detail => grant.fleetIds.includes(detail.id) && detail.siteIds.includes(id))) })) });
        }} />)}
      </View>)}
      {setup.fleets.filter(fleet=>fleet.id===selectedFleet).map(fleet=><FleetProfileEditor key={fleet.id} profile={fleet.operationalProfile} disabled={busy} onChange={profile=>setSetup(current=>current?{...current,fleets:current.fleets.map(item=>{if(item.id!==fleet.id)return item;const next={...item};if(profile)next.operationalProfile=profile;else delete next.operationalProfile;return next;})}:current)}/>)}
      <TextInput accessibilityLabel={copy("New resource pool name")} placeholder={copy("New resource pool name")} editable={!busy} value={name} onChangeText={setName} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border }}/>
      <TextInput accessibilityLabel={copy("Required Fleet certifications")} placeholder={copy("Required certification names, separated by commas")} value={certifications} onChangeText={setCertifications} style={{ color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border }}/>
      {setup.sites.map(site => <FleetCheckbox key={site.siteId} label={site.name} disabled={busy} checked={sites.includes(site.siteId)} onChange={checked => setSites(current => checked ? [...current, site.siteId] : current.filter(id => id !== site.siteId))} />)}
      <TogglePillButton compactOnTablet disabled={busy} onPress={addFleet}>{copy("Add resource pool to draft")}</TogglePillButton>
      <Text style={{ color: colors.text }}>{copy("Choose company resource access for an existing member")}</Text>
      {setup.members.map(member => <TogglePillButton compactOnTablet key={member.userId} solid={memberId === member.userId} onPress={() => { setMemberId(member.userId); setRoles([]); }}>{member.name}</TogglePillButton>)}
      {(["fleet_manager", "dispatcher", "driver"] as const).map(role => <FleetCheckbox key={role} label={copy(role.replaceAll("_", " "))} disabled={busy} checked={roles.includes(role)} onChange={checked => setRoles(current => checked ? [...current, role] : current.filter(item => item !== role))} />)}
      <TogglePillButton compactOnTablet disabled={busy} onPress={setGrant}>{copy("Add grant to draft")}</TogglePillButton>
      <TogglePillButton compactOnTablet disabled={busy || !memberId} color="red" onPress={() => setSetup({ ...setup, grants: setup.grants.filter(grant => grant.userId !== memberId) })}>{copy("Remove selected member's Fleet grant from draft")}</TogglePillButton>
      {setup.grants.map(grant => <Text key={grant.userId} style={{ color: colors.text }}>{setup.members.find(m => m.userId === grant.userId)?.name ?? `Member ${grant.userId}`}{copy(": ")}{grant.roles.map(role => copy(role.replaceAll("_", " "))).join(", ")}{copy(" \u00B7 ")}{grant.roles.some(role=>["fleet_manager","dispatcher"].includes(role))?`${grant.fleetIds.length} ${copy("resource pools")} · ${grant.siteIds.length} ${copy("billing sites")}`:copy("Company driver pool")}</Text>)}
      <TogglePillButton compactOnTablet disabled={busy} onPress={() => void save()}>{copy("Save Fleet access settings")}</TogglePillButton>
    </>}
  </View>;
}
