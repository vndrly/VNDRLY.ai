import { Stack, useLocalSearchParams } from "expo-router";
import InPageHeader from "@/components/InPageHeader";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import BlueButton from "@/components/BlueButton";
import GreyButton from "@/components/GreyButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import { getUser, type StoredUser } from "@/lib/auth";

// Mobile parity with the web Invoice Detail bulk 1099-category UI.
// Task #379: the web app exposes a multi-select + "Set 1099 category" bulk
// control on /invoices/:id with an inline Undo affordance after every
// successful apply. Foremen and vendor admins increasingly do their year-end
// 1099 cleanup from the field on mobile, so we mirror the same flow here.
//
// The undo round-trip uses the `updates`-shaped PATCH /invoices/:id/lines
// payload that the server already accepts (see api-server/src/routes/invoices.ts
// PatchLinesBulkBody) so the prior incomeCategory AND prior isManualOverride
// flag are restored in a single call. No new server work was required.

type IncomeCategory =
  | "nec"
  | "misc_rents"
  | "misc_royalties"
  | "misc_other_income"
  | "misc_prizes_awards"
  | "misc_medical_health"
  | "misc_attorney"
  | "k_third_party_network"
  | "none";

const INCOME_CATEGORIES: IncomeCategory[] = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k_third_party_network",
  "none",
];

interface InvoiceLine {
  id: number;
  description: string;
  amount: string;
  lineType: string;
  incomeCategory: IncomeCategory;
  isManualOverride: boolean;
}

interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  status: string;
  total: string;
  lines: InvoiceLine[];
}

interface CategorySnapshotEntry {
  lineId: number;
  incomeCategory: IncomeCategory;
  isManualOverride: boolean;
}

interface BulkApplyResponse {
  ok: true;
  updated: number;
  previousCategories?: CategorySnapshotEntry[];
}

interface UndoResponse {
  ok: true;
  updated: number;
}

function formatMoney(s: string | number | null | undefined): string {
  if (s == null) return "—";
  const n = typeof s === "number" ? s : Number(s);
  if (!Number.isFinite(n)) return String(s);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export default function InvoiceDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const { t } = useTranslation();
  const colors = useColors();

  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<StoredUser | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<IncomeCategory>("nec");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Undo banner state. Holds the snapshot returned by the most recent
  // successful bulk apply; cleared after a successful undo OR after the
  // user dismisses the banner. Mirrors the toast-with-action affordance
  // on the web detail page.
  const [undoSnapshot, setUndoSnapshot] = useState<{
    snapshot: CategorySnapshotEntry[];
    appliedCount: number;
  } | null>(null);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-dismiss the Undo banner after 10s so it doesn't linger past the
  // user's intent — matches the web ToastAction lifetime.
  const armUndoBanner = useCallback(
    (snapshot: CategorySnapshotEntry[], appliedCount: number) => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoSnapshot({ snapshot, appliedCount });
      undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 10000);
    },
    [],
  );
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const json = await apiFetch<InvoiceDetail>(`/api/invoices/${id}`);
      setData(json);
      setLoadError(null);
    } catch (err) {
      setLoadError(translateApiError(err, t, t("invoices.loadFailed")));
    }
  }, [id, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await getUser();
      if (!cancelled) setUser(u);
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const isAdmin = user?.role === "admin";
  const isVendor = user?.role === "vendor" && data?.vendorId === user?.vendorId;
  const canManageBilling = isAdmin || isVendor;

  const lineIds = useMemo(() => (data?.lines ?? []).map((l) => l.id), [data]);
  const allSelected =
    lineIds.length > 0 && selected.size === lineIds.length;

  const toggleLine = (lineId: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((cur) =>
      cur.size === lineIds.length ? new Set() : new Set(lineIds),
    );
  };

  const applyBulk = async () => {
    if (selected.size === 0 || applying) return;
    setApplying(true);
    try {
      const res = await apiFetch<BulkApplyResponse>(
        `/api/invoices/${id}/lines`,
        {
          method: "PATCH",
          body: JSON.stringify({
            lineIds: Array.from(selected),
            incomeCategory: bulkCategory,
          }),
        },
      );
      // Optimistically reflect the change in the UI without waiting for
      // a refetch — keeps the Undo banner immediately actionable on a
      // flaky connection.
      setData((cur) =>
        cur
          ? {
              ...cur,
              lines: cur.lines.map((l) =>
                selected.has(l.id)
                  ? {
                      ...l,
                      incomeCategory: bulkCategory,
                      isManualOverride: true,
                    }
                  : l,
              ),
            }
          : cur,
      );
      setSelected(new Set());
      const snapshot = res.previousCategories ?? [];
      if (snapshot.length > 0) {
        armUndoBanner(snapshot, res.updated);
      }
      // Refetch in the background so any other server-side changes (e.g.
      // a concurrent regenerate) reconcile.
      void load();
    } catch (err) {
      Alert.alert(
        t("common.error"),
        translateApiError(err, t, t("invoices.toast.bulkCategoryFailed")),
      );
    } finally {
      setApplying(false);
    }
  };

  const undoBulk = async () => {
    if (!undoSnapshot || undoing) return;
    setUndoing(true);
    try {
      await apiFetch<UndoResponse>(`/api/invoices/${id}/lines`, {
        method: "PATCH",
        body: JSON.stringify({ updates: undoSnapshot.snapshot }),
      });
      // Apply the snapshot locally so the row categories revert without a
      // refetch round-trip.
      setData((cur) => {
        if (!cur) return cur;
        const byId = new Map(
          undoSnapshot.snapshot.map((s) => [s.lineId, s] as const),
        );
        return {
          ...cur,
          lines: cur.lines.map((l) => {
            const s = byId.get(l.id);
            return s
              ? {
                  ...l,
                  incomeCategory: s.incomeCategory,
                  isManualOverride: s.isManualOverride,
                }
              : l;
          }),
        };
      });
      setUndoSnapshot(null);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      void load();
    } catch (err) {
      Alert.alert(
        t("common.error"),
        translateApiError(err, t, t("invoices.toast.bulkCategoryUndoFailed")),
      );
    } finally {
      setUndoing(false);
    }
  };

  if (loading) {
    return (
      <View
        style={styles.center}
        testID="invoice-detail-loading"
      >
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("invoices.detail.title")} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (loadError || !data) {
    return (
      <View
        style={styles.center}
        testID="invoice-detail-error"
      >
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("invoices.detail.title")} />
        <Text style={{ color: colors.foreground }}>
          {loadError ?? t("invoices.loadFailed")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      testID="invoice-detail-screen"
      stickyHeaderIndices={[0]}
    >
      <View>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader title={t("invoices.detail.title")} />
      </View>

      <View style={styles.headerRow}>
        <Text style={[styles.invoiceNumber, { color: colors.foreground }]}>
          {data.invoiceNumber}
        </Text>
        <Text style={[styles.invoiceTotal, { color: colors.mutedForeground }]}>
          {formatMoney(data.total)}
        </Text>
      </View>

      {canManageBilling ? (
        <View
          style={[
            styles.bulkCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          testID="bulk-actions-card"
        >
          <Pressable
            onPress={toggleAll}
            style={styles.selectAllRow}
            testID="checkbox-select-all-lines"
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: colors.border,
                  backgroundColor: allSelected
                    ? colors.primary
                    : "transparent",
                },
              ]}
            />
            <Text
              style={{ color: colors.foreground }}
              testID="text-bulk-selection-summary"
            >
              {t("invoices.bulk.selectionSummary", {
                count: selected.size,
                total: data.lines.length,
              })}
            </Text>
          </Pressable>

          <View style={styles.bulkControlsRow}>
            <Text style={{ color: colors.mutedForeground }}>
              {t("invoices.bulk.setCategoryLabel")}
            </Text>
            <Pressable
              onPress={() => setPickerOpen((v) => !v)}
              style={[
                styles.pickerTrigger,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
              testID="select-bulk-income-category"
              accessibilityRole="button"
            >
              <Text style={{ color: colors.foreground }}>
                {t(`invoices.incomeCategory.${bulkCategory}`)}
              </Text>
            </Pressable>
            <BlueButton
              onPress={applyBulk}
              disabled={selected.size === 0}
              loading={applying}
              testID="button-apply-bulk-category"
            >
              {t("invoices.bulk.apply")}
            </BlueButton>
            <GreyButton
              onPress={() => setSelected(new Set())}
              disabled={selected.size === 0 || applying}
              testID="button-clear-bulk-selection"
            >
              {t("invoices.bulk.clear")}
            </GreyButton>
          </View>

          {pickerOpen ? (
            <View style={styles.pickerList} testID="bulk-category-picker">
              {INCOME_CATEGORIES.map((c) => {
                const isActive = c === bulkCategory;
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setBulkCategory(c);
                      setPickerOpen(false);
                    }}
                    style={[
                      styles.pickerRow,
                      {
                        borderColor: colors.border,
                        backgroundColor: isActive
                          ? colors.accent
                          : "transparent",
                      },
                    ]}
                    testID={`bulk-category-option-${c}`}
                  >
                    <Text style={{ color: colors.foreground }}>
                      {t(`invoices.incomeCategory.${c}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {undoSnapshot ? (
        <View
          style={[
            styles.undoBanner,
            { backgroundColor: colors.accent, borderColor: colors.border },
          ]}
          testID="undo-bulk-category-banner"
        >
          <Text
            style={[styles.undoText, { color: colors.foreground }]}
            testID="undo-bulk-category-message"
          >
            {t("invoices.toast.bulkCategorySet", {
              count: undoSnapshot.appliedCount,
            })}
          </Text>
          <View style={styles.undoActions}>
            <BlueButton
              onPress={undoBulk}
              loading={undoing}
              testID="button-undo-bulk-category"
            >
              {t("invoices.toast.undo")}
            </BlueButton>
            <GreyButton
              onPress={() => {
                setUndoSnapshot(null);
                if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              }}
              disabled={undoing}
              testID="button-dismiss-undo-bulk-category"
            >
              {t("common.ok")}
            </GreyButton>
          </View>
        </View>
      ) : null}

      <View style={styles.linesSection}>
        {data.lines.map((line) => {
          const isSelected = selected.has(line.id);
          return (
            <Pressable
              key={line.id}
              onPress={() => canManageBilling && toggleLine(line.id)}
              disabled={!canManageBilling}
              style={[
                styles.lineRow,
                {
                  borderColor: colors.border,
                  backgroundColor: isSelected ? colors.accent : colors.card,
                },
              ]}
              testID={`row-line-${line.id}`}
            >
              {canManageBilling ? (
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: colors.border,
                      backgroundColor: isSelected
                        ? colors.primary
                        : "transparent",
                    },
                  ]}
                  testID={`checkbox-line-${line.id}`}
                />
              ) : null}
              <View style={styles.lineBody}>
                <Text
                  style={[styles.lineDescription, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {line.description}
                </Text>
                <Text
                  style={{ color: colors.mutedForeground }}
                  testID={`line-category-${line.id}`}
                >
                  {t(`invoices.incomeCategory.${line.incomeCategory}`)}
                </Text>
              </View>
              <Text
                style={[styles.lineAmount, { color: colors.foreground }]}
              >
                {formatMoney(line.amount)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  invoiceNumber: {
    fontSize: 20,
    fontWeight: "700",
  },
  invoiceTotal: {
    fontSize: 16,
  },
  bulkCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bulkControlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  pickerTrigger: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    minWidth: 180,
  },
  pickerList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: "hidden",
  },
  pickerRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
  },
  undoBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  undoText: {
    fontSize: 14,
  },
  undoActions: {
    flexDirection: "row",
    gap: 8,
  },
  linesSection: {
    gap: 8,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  lineBody: {
    flex: 1,
    gap: 4,
  },
  lineDescription: {
    fontSize: 14,
    fontWeight: "600",
  },
  lineAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
});
