import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, Stack } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import type {
  ScheduledTicket,
  UpcomingScheduleResponse,
} from "@workspace/api-client-react";

import ActiveOrgIndicator from "@/components/ActiveOrgIndicator";
import ForemanScheduleTicketsModal from "@/components/ForemanScheduleTicketsModal";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { setScheduleBadge } from "@/lib/tabBadges";
import { openScheduleIcs } from "@/lib/openScheduleIcs";
import { translateApiError } from "@/lib/apiErrors";
import { openInMaps } from "@/lib/maps";
import {
  ticketStaleDays,
  ticketStatusLabel,
  ticketStatusPillStyle,
} from "@/lib/ticketStatusLabels";
import { PILL_CHIP_LAYOUT, PILL_TEXT } from "@/lib/pill-doctrine";
import { isPartnerOfficeUser } from "@/lib/mobile-viewer";

type PortalScheduledRow = {
  id: number;
  status: string;
  scheduledStartAt: string | null;
  scheduledDurationMinutes: number | null;
  siteName: string | null;
  siteAddress?: string | null;
  siteLatitude?: number | string | null;
  siteLongitude?: number | string | null;
  vendorName: string | null;
  workTypeName: string | null;
  updatedAt: string | null;
};

type PortalScheduledResponse = PortalScheduledRow[] | {
  items?: PortalScheduledRow[];
};

type ScheduleResponseWithHistory = UpcomingScheduleResponse & {
  recentTickets?: ScheduledTicket[];
};

function mapPortalScheduledRow(row: PortalScheduledRow): ScheduledTicket {
  return {
    id: row.id,
    scheduledStartAt: row.scheduledStartAt,
    scheduledDurationMinutes: row.scheduledDurationMinutes,
    status: row.status as ScheduledTicket["status"],
    updatedAt: row.updatedAt,
    siteName: row.siteName,
    siteAddress: row.siteAddress ?? null,
    siteLatitude: row.siteLatitude == null ? null : Number(row.siteLatitude),
    siteLongitude: row.siteLongitude == null ? null : Number(row.siteLongitude),
    partnerName: null,
    vendorName: row.vendorName,
    workTypeName: row.workTypeName,
    foremanUserId: null,
    foremanName: "",
    isForeman: false,
    myAckStatus: null,
    crew: [],
  };
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ScheduleScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const { user } = useAuth();
  const isForeman =
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both");
  const isPartner = isPartnerOfficeUser(user);
  const [upcomingTickets, setUpcomingTickets] = useState<ScheduledTicket[]>([]);
  const [recentTickets, setRecentTickets] = useState<ScheduledTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [pickTicketOpen, setPickTicketOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isPartner) {
        const now = Date.now();
        const horizon = Date.now() + 14 * 24 * 60 * 60 * 1000;
        const historyStart = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const response = await apiFetch<PortalScheduledResponse>("/api/tickets");
        const rows = Array.isArray(response) ? response : response?.items ?? [];
        const scheduledRows = (rows ?? [])
          .filter((row) => {
            if (!row.scheduledStartAt) return false;
            const ts = Date.parse(row.scheduledStartAt);
            return Number.isFinite(ts) && ts >= historyStart && ts <= horizon;
          })
          .map(mapPortalScheduledRow);
        setUpcomingTickets(
          scheduledRows
            .filter((row) => {
              const ts = row.scheduledStartAt ? Date.parse(row.scheduledStartAt) : 0;
              return ts >= now && ts <= horizon;
            })
            .sort(
              (a, b) =>
                Date.parse(a.scheduledStartAt!) - Date.parse(b.scheduledStartAt!),
            ),
        );
        setRecentTickets(
          scheduledRows
            .filter((row) => {
              const ts = row.scheduledStartAt ? Date.parse(row.scheduledStartAt) : 0;
              return ts < now && ts >= historyStart;
            })
            .sort(
              (a, b) =>
                Date.parse(b.scheduledStartAt!) - Date.parse(a.scheduledStartAt!),
            ),
        );
      } else {
        const r = await apiFetch<ScheduleResponseWithHistory>(
          "/api/me/upcoming-schedule?days=14&historyDays=14",
        );
        setUpcomingTickets(r?.tickets ?? []);
        setRecentTickets(r?.recentTickets ?? []);
      }
    } catch {
      setUpcomingTickets([]);
      setRecentTickets([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isPartner]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      if (isForeman) {
        apiFetch<{ vendorId: number | null }>("/api/field/me")
          .then((me) => setVendorId(me.vendorId ?? null))
          .catch(() => setVendorId(null));
      }
    }, [load, isForeman]),
  );

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  // Tab badge: count jobs that need a scheduling response from the
  // current user (pending ack). Updates live as acks resolve.
  useEffect(() => {
    if (isPartner) {
      setScheduleBadge(upcomingTickets.length);
      return;
    }
    setScheduleBadge(upcomingTickets.filter((tk) => tk.myAckStatus === "pending").length);
  }, [isPartner, upcomingTickets]);

  async function ack(ticketId: number, status: "confirmed" | "declined") {
    try {
      await apiFetch(`/api/tickets/${ticketId}/crew/ack`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      const updateAck = (prev: ScheduledTicket[]) =>
        prev.map((tk) => (tk.id === ticketId ? { ...tk, myAckStatus: status } : tk));
      setUpcomingTickets(updateAck);
      setRecentTickets(updateAck);
    } catch (e) {
      Alert.alert(
        t("mySchedule.ackErrorTitle"),
        translateApiError(e, t),
      );
    }
  }

  function confirmDecline(ticketId: number) {
    Alert.alert(
      t("mySchedule.declineTitle"),
      t("mySchedule.declineBody"),
      [
        { text: t("mySchedule.cancel"), style: "cancel" },
        {
          text: t("mySchedule.declineConfirm"),
          style: "destructive",
          onPress: () => void ack(ticketId, "declined"),
        },
      ],
    );
  }

  async function addToCalendar(ticketId: number) {
    try {
      await openScheduleIcs(ticketId, t);
    } catch (e) {
      Alert.alert(
        t("mySchedule.calendarErrorTitle"),
        e instanceof Error ? e.message : translateApiError(e, t),
      );
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <InPageHeader
          title={t("tabs.schedule")}
          right={<ActiveOrgIndicator />}
        />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("tabs.schedule")}
        right={<ActiveOrgIndicator />}
      />
      {isForeman ? (
        <View style={styles.foremanBar}>
          <LayeredPillButton
            onPress={() => setPickTicketOpen(true)}
            height={44}
            style={styles.foremanAddBtn}
            testID="button-schedule-ticket"
          >
            <Feather name="calendar" size={16} color="#ffffff" style={styles.pillIconShadow} />
            <Text style={[styles.foremanAddText, styles.pillTextShadow]}>
              {t("foremanSchedule.scheduleTicket")}
            </Text>
          </LayeredPillButton>
        </View>
      ) : null}
      <View style={styles.scheduleSections}>
        <View style={styles.upcomingSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t("mySchedule.upcomingTitle")}
          </Text>
          <FlatList
            style={styles.sectionList}
            contentContainerStyle={styles.sectionListContent}
            data={upcomingTickets}
            keyExtractor={(item) => `upcoming-${item.id}`}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {isPartner
                  ? t("partnerSchedule.empty")
                  : isForeman
                    ? t("foremanSchedule.emptyForeman")
                    : t("mySchedule.empty")}
              </Text>
            }
            renderItem={({ item }) => (
              <ScheduleTicketCard
                item={item}
                colors={colors}
                brandColor={brand.primary}
                isPartner={isPartner}
                t={t}
                onAck={ack}
                onDecline={confirmDecline}
                onAddToCalendar={addToCalendar}
              />
            )}
          />
        </View>
        <View style={styles.recentSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t("mySchedule.recentTitle")}
          </Text>
          <FlatList
            style={styles.sectionList}
            contentContainerStyle={styles.sectionListContent}
            data={recentTickets}
            keyExtractor={(item) => `recent-${item.id}`}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {t("mySchedule.recentEmpty")}
              </Text>
            }
            renderItem={({ item }) => (
              <ScheduleTicketCard
                item={item}
                colors={colors}
                brandColor={brand.primary}
                isPartner={isPartner}
                t={t}
                onAck={ack}
                onDecline={confirmDecline}
                onAddToCalendar={addToCalendar}
              />
            )}
          />
        </View>
      </View>
    {isForeman && vendorId != null ? (
      <ForemanScheduleTicketsModal
        visible={pickTicketOpen}
        vendorId={vendorId}
        onClose={() => setPickTicketOpen(false)}
        onScheduled={() => {
          setLoading(true);
          void load();
        }}
      />
    ) : null}
    </View>
  );
}

type ScheduleTicketCardProps = {
  item: ScheduledTicket;
  colors: ReturnType<typeof useColors>;
  brandColor: string;
  isPartner: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  onAck: (ticketId: number, status: "confirmed" | "declined") => Promise<void>;
  onDecline: (ticketId: number) => void;
  onAddToCalendar: (ticketId: number) => Promise<void>;
};

function ScheduleTicketCard({
  item,
  colors,
  brandColor,
  isPartner,
  t,
  onAck,
  onDecline,
  onAddToCalendar,
}: ScheduleTicketCardProps) {
  const crewNames = item.crew
    .filter((c: { isMe?: boolean }) => !c.isMe)
    .map((c: { name?: string | null }) => c.name)
    .filter(Boolean);
  const canDirections = item.siteLatitude != null && item.siteLongitude != null;
  const ackStatus = item.myAckStatus;
  const ackPill =
    ackStatus === "pending"
      ? { background: "#7c3aed", foreground: "#ffffff" }
      : ackStatus === "confirmed"
        ? { background: "#16a34a", foreground: "#ffffff" }
        : ackStatus === "declined"
          ? { background: "#dc2626", foreground: "#ffffff" }
          : null;
  const ackLabel = ackStatus === "confirmed"
    ? t("mySchedule.ackConfirmed")
    : ackStatus === "declined"
      ? t("mySchedule.ackDeclined")
      : t("mySchedule.ackPending");
  const basePill = ticketStatusPillStyle(item.status, item.updatedAt);
  const statusPill =
    item.status === "draft"
      ? { background: "#7c3aed", foreground: "#ffffff" }
      : basePill;
  const staleDays = ticketStaleDays(item.status, item.updatedAt);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: brandColor },
      ]}
    >
      <TouchableOpacity onPress={() => router.push(`/ticket/${item.id}`)}>
        <View style={styles.row}>
          <Text style={[styles.id, { color: colors.foreground }]}>
            #{String(item.id).padStart(4, "0")}
          </Text>
          <View style={styles.statusGroup}>
            {staleDays != null ? (
              <Text
                style={[styles.staleText, { color: colors.mutedForeground }]}
                accessibilityLabel={t("tickets.staleSuffixA11y", { days: staleDays })}
                testID={`text-schedule-stale-${item.id}`}
              >
                {t("tickets.staleSuffix", { days: staleDays })}
              </Text>
            ) : null}
            <View
              style={[styles.badge, { backgroundColor: statusPill.background }]}
              testID={`badge-schedule-status-${item.id}`}
            >
              <Text style={[styles.badgeText, { color: statusPill.foreground }]}>
                {ticketStatusLabel(item.status, t)}
              </Text>
            </View>
          </View>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {item.siteName || t("tickets.siteFallbackPlaceholder")}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {item.workTypeName || t("tickets.workTypeFallbackPlaceholder")}
          {isPartner && item.vendorName
            ? t("tickets.vendorSuffix", { vendor: item.vendorName })
            : item.partnerName
              ? t("tickets.partnerSuffix", { partner: item.partnerName })
              : ""}
        </Text>
        <View style={styles.metaRow}>
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {formatWhen(item.scheduledStartAt)}
            {item.scheduledDurationMinutes ? ` · ${item.scheduledDurationMinutes}m` : ""}
          </Text>
        </View>
        {item.foremanName ? (
          <View style={styles.metaRow}>
            <Feather name="user-check" size={14} color={colors.mutedForeground} />
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {t("mySchedule.foreman", { name: item.foremanName })}
            </Text>
          </View>
        ) : null}
        {crewNames.length > 0 ? (
          <View style={styles.metaRow}>
            <Feather name="users" size={14} color={colors.mutedForeground} />
            <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
              {t("mySchedule.crewmates", { names: crewNames.join(", ") })}
            </Text>
          </View>
        ) : null}
        {ackStatus != null && ackPill != null ? (
          <View style={styles.metaRow}>
            <View style={[styles.ackPill, { backgroundColor: ackPill.background }]}>
              <Text style={[styles.ackPillText, { color: ackPill.foreground }]}>{ackLabel}</Text>
            </View>
          </View>
        ) : null}
      </TouchableOpacity>

      {ackStatus != null && ackStatus !== "confirmed" && !isPartner ? (
        <View style={styles.ackRow}>
          {ackStatus === "pending" ? (
            <LayeredPillButton
              onPress={() => onDecline(item.id)}
              height={40}
              color="#dc2626"
              style={styles.ackBtnPill}
              testID={`button-decline-${item.id}`}
            >
              <Feather name="x" size={14} color="#ffffff" style={styles.pillIconShadow} />
              <Text style={[styles.ackPillBtnText, styles.pillTextShadow]}>
                {t("mySchedule.decline")}
              </Text>
            </LayeredPillButton>
          ) : null}
          <LayeredPillButton
            onPress={() => void onAck(item.id, "confirmed")}
            height={40}
            color="#16a34a"
            style={styles.ackBtnPill}
            testID={`button-confirm-${item.id}`}
          >
            <Feather name="check" size={14} color="#ffffff" style={styles.pillIconShadow} />
            <Text style={[styles.ackPillBtnText, styles.pillTextShadow]}>
              {t("mySchedule.confirm")}
            </Text>
          </LayeredPillButton>
        </View>
      ) : null}

      {!isPartner && item.isForeman ? (
        <LayeredPillButton
          onPress={() => router.push(`/ticket/${item.id}/crew-tracker`)}
          height={40}
          inactive
          style={styles.foremanBtnPill}
          testID={`button-foreman-view-${item.id}`}
        >
          <Feather name="users" size={14} color="#ffffff" />
          <Text style={styles.ackPillBtnText}>{t("mySchedule.foremanView")}</Text>
        </LayeredPillButton>
      ) : null}

      {canDirections ? (
        <LayeredPillButton
          onPress={() =>
            openInMaps(item.siteLatitude!, item.siteLongitude!, item.siteName ?? undefined)
          }
          height={40}
          style={styles.directionsBtnPill}
          testID={`button-directions-${item.id}`}
        >
          <Feather name="navigation" size={14} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.ackPillBtnText, styles.pillTextShadow]}>
            {t("mySchedule.getDirections")}
          </Text>
        </LayeredPillButton>
      ) : null}

      {!isPartner ? (
        <LayeredPillButton
          onPress={() => void onAddToCalendar(item.id)}
          inactive
          style={styles.foremanBtnPill}
          testID={`button-calendar-${item.id}`}
        >
          <Feather name="calendar" size={14} color="#ffffff" />
          <Text style={styles.ackPillBtnText}>{t("mySchedule.addToCalendar")}</Text>
        </LayeredPillButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  foremanBar: { paddingHorizontal: 16, paddingBottom: 8 },
  foremanAddBtn: { alignSelf: "stretch" },
  foremanAddText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  scheduleSections: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
  },
  upcomingSection: {
    flex: 2,
    minHeight: 0,
  },
  recentSection: {
    flex: 1,
    minHeight: 0,
  },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    marginBottom: 8,
  },
  sectionList: {
    flex: 1,
  },
  sectionListContent: {
    paddingBottom: 8,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 24,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  id: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  badge: { ...PILL_CHIP_LAYOUT },
  badgeText: { ...PILL_TEXT },
  // Task #890: groups the stale-time suffix with the status pill so
  // they read as a single status block on the right side of the row.
  statusGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 6 },
  metaRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  directionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  directionsText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  ackPill: { ...PILL_CHIP_LAYOUT, marginTop: 2 },
  ackPillText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  ackRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  ackBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  ackBtnDecline: { borderWidth: 1, backgroundColor: "transparent" },
  ackBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  ackBtnPill: { flex: 1 },
  ackPillBtnText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  foremanBtnPill: { alignSelf: "stretch", marginTop: 8 },
  directionsBtnPill: { alignSelf: "stretch", marginTop: 12 },
  pillTextShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  pillIconShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  foremanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  foremanText: { fontFamily: "Inter_500Medium", fontSize: 13 },
});
