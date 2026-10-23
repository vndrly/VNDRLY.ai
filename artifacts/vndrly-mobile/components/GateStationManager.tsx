import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { changeOverRequest } from "@/lib/change-over-api";
import TogglePillButton from "@/components/TogglePillButton";

export default function GateStationManager({ onCreated }: { onCreated: () => void }) {
  const { user, activeMembershipId } = useAuth();
  if (!user) return null;
  return <Manager key={JSON.stringify([user.id, activeMembershipId, captureAuthScope().generation, user.vendorId, user.partnerId])} onCreated={onCreated} />;
}
function Manager({ onCreated }: { onCreated: () => void }) {
  const { user, activeMembershipId } = useAuth(), colors = useColors(), { t } = useTranslation();
  const [open, setOpen] = useState(false), [siteId, setSite] = useState<number | null>(null), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const alive = useRef(true), locked = useRef(false), scope = useRef(captureAuthScope()).current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sites = useQuery({ queryKey: ["gate-station-management-sites", user?.id, activeMembershipId, scope.generation, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/station-management/sites"), enabled: Boolean(user), retry: false });
  const allowed = sites.data?.sites ?? [], selected = allowed.find(site => site.id === siteId) ?? allowed[0];
  if (!allowed.length || sites.isError) return null;
  async function save() {
    if (!isAuthScopeCurrent(scope) || locked.current || !selected || !name.trim() || sites.isError) return;
    locked.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      await changeOverRequest("/stations", { siteId: selected.id, name: name.trim() });
      if (alive.current && isAuthScopeCurrent(scope)) { setName(""); setOpen(false); setSaved(true); onCreated(); void sites.refetch(); }
    } catch { if (alive.current && isAuthScopeCurrent(scope)) setError(t("gateLocations.error")); }
    finally { locked.current = false; if (alive.current && isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <View style={{ borderColor: colors.primary, borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: "#242426", gap: 10 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("changeOver.addGate")} accessibilityState={{ expanded: open }} onPress={() => !busy && setOpen(value => !value)}>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 16 }}>{t("changeOver.addGate")} {open ? "⌃" : "⌄"}</Text>
    </Pressable>
    {open && <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{allowed.map(site => <TogglePillButton key={site.id} disabled={busy} solid={site.id === selected.id} onPress={() => setSite(site.id)}>{site.name}</TogglePillButton>)}</View>
      <TextInput accessibilityLabel={t("changeOver.newGate")} value={name} onChangeText={setName} editable={!busy} maxLength={80} style={{ color: colors.foreground, borderColor: colors.primary, borderWidth: 1, borderRadius: 8, padding: 10 }} />
      <TogglePillButton disabled={busy || !name.trim()} onPress={() => void save()}>{t("gateLocations.save")}</TogglePillButton>
    </>}
    {saved && <Text style={{ color: colors.foreground }}>{t("gateLocations.saved")}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.foreground }}>{error}</Text>}
  </View>;
}
