import React, { useCallback, useEffect, useState } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import InPageHeader from "@/components/InPageHeader";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Assignment = { id: number; vendorName: string | null; workTypeName: string | null; isGateContractor?: boolean };

/** The API rechecks site ownership on every read and designation change. */
export default function SiteGateContractorsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = user?.role === "partner" || user?.role === "admin";
  const id = Number(siteId);
  const valid = Number.isSafeInteger(id) && id > 0;
  const load = useCallback(async () => {
    if (!allowed || !valid) return;
    setLoading(true);
    setError(null);
    try {
      setAssignments(await apiFetch<Assignment[]>(`/api/site-locations/${id}/assignments`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally { setLoading(false); }
  }, [allowed, valid, id, t]);
  useEffect(() => { void load(); }, [load]);
  const update = async (assignment: Assignment, value: boolean) => {
    if (!allowed || !valid || saving !== null) return;
    setSaving(assignment.id);
    try {
      const saved = await apiFetch<Assignment>(`/api/site-locations/${id}/assignments/${assignment.id}`, {
        method: "PATCH", body: JSON.stringify({ isGateContractor: value }),
      });
      setAssignments(rows => rows.map(row => row.id === assignment.id ? saved : row));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("common.error"));
    } finally { setSaving(null); }
  };
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} />}>
    <Stack.Screen options={{ headerShown: false }} />
    <InPageHeader title={t("siteLocations.gateContractors")} />
    {!allowed || !valid ? <Text style={{ color: colors.foreground }}>{t("siteLocations.gateContractorOwnerOnly")}</Text> : <>
      <Text style={{ color: colors.mutedForeground }}>{t("siteLocations.gateContractorHelp")}</Text>
      {error && <Text accessibilityRole="alert" style={{ color: colors.foreground }}>{error}</Text>}
      {loading && <ActivityIndicator />}
      {!loading && !error && assignments.length === 0 && <Text style={{ color: colors.foreground }}>{t("siteLocations.noAssignments")}</Text>}
      {assignments.map(assignment => <View key={assignment.id} style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card }}>
        <Text style={{ color: colors.foreground }}>{assignment.vendorName} · {assignment.workTypeName}</Text>
        <Switch accessibilityLabel={t("siteLocations.gateContractorLabel", { vendor: assignment.vendorName, work: assignment.workTypeName })}
          value={assignment.isGateContractor === true} disabled={saving !== null || loading}
          onValueChange={value => { void update(assignment, value); }} />
        {saving === assignment.id && <ActivityIndicator />}
      </View>)}
    </>}
  </ScrollView>;
}
