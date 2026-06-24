import { Feather } from "@expo/vector-icons";
import { router, Stack, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import InPageHeader from "@/components/InPageHeader";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Person = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorRole?: string | null;
  jobTitle?: string | null;
  pecExpirationDate?: string | null;
  pecCertification?: boolean;
};

export default function EmployeesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isForemanOnly =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");
  const vendorId = user?.vendorId ?? null;

  const load = useCallback(async () => {
    if (!vendorId) {
      setRows([]);
      return;
    }
    try {
      const [fieldRows, officeRows] = await Promise.all([
        apiFetch<Person[]>(`/api/field-employees?vendorId=${vendorId}&includeInactive=true`).catch(() => [] as Person[]),
        apiFetch<Person[]>(`/api/vendor-contacts?vendorId=${vendorId}`).catch(() => [] as Person[]),
      ]);
      const byId = new Map<number, Person>();
      for (const r of [...(fieldRows ?? []), ...(officeRows ?? [])]) byId.set(r.id, r);
      setRows(Array.from(byId.values()).sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const canEdit = (p: Person) => !isForemanOnly || p.vendorRole !== "admin";

  return (
    <View style={[styles.flex, { backgroundColor: colors.pageBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("employees.title")} right={<ActiveOrgIndicator />} />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.primary} />}
          contentContainerStyle={styles.listPad}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
              disabled={!canEdit(item)}
              onPress={() => router.push(`/employee/${item.id}`)}
              testID={`employee-row-${item.id}`}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.name, { color: colors.foreground }]}>{item.firstName} {item.lastName}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {[item.jobTitle, item.vendorRole?.toUpperCase(), item.email].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {canEdit(item) ? <Feather name="chevron-right" size={18} color={colors.mutedForeground} /> : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>{t("employees.empty")}</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: 16, gap: 10 },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  rowMain: { flex: 1 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 4 },
  empty: { textAlign: "center", marginTop: 24, fontFamily: "Inter_400Regular" },
});
