import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useWindowDimensions } from "react-native";
import { askVActionsForTicket, askVPromptRoute } from "@/lib/assistant-ticket-actions";
import TicketWorkAction from "@/components/TicketWorkAction";
import LayeredPillButton from "@/components/LayeredPillButton";
import { TicketRouteMap } from "@/components/TicketRouteMap";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { openInMaps } from "@/lib/maps";

type SiteVisitPerson = {
  key: string;
  role: "lead" | "crew";
  employeeId: number;
  employeeName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  onSiteMinutes: number | null;
  travelMinutes: number | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  checkInDistanceMeters: number | null;
  insideGeofence: boolean | null;
  replayDate: string | null;
};

type SiteVisitSummary = {
  site: {
    name: string | null;
    latitude: number;
    longitude: number;
    siteRadiusMeters: number;
  } | null;
  timeline: {
    enRouteAt: string | null;
    arrivedAt: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
  };
  route: Array<{
    id: number;
    latitude: number;
    longitude: number;
    recordedAt: string;
  }>;
  people: SiteVisitPerson[];
  totals: {
    peopleCount: number;
    totalOnSiteMinutes: number;
    leadTravelMinutes: number | null;
    routePointCount: number;
  };
};

function normalizeSiteVisitSummary(
  json: Partial<SiteVisitSummary> & Record<string, unknown>,
): SiteVisitSummary {
  return {
    site: json.site ?? null,
    timeline: json.timeline ?? {
      enRouteAt: null,
      arrivedAt: null,
      checkInTime: null,
      checkOutTime: null,
    },
    route: Array.isArray(json.route) ? json.route : [],
    people: Array.isArray(json.people) ? json.people : [],
    totals: json.totals ?? {
      peopleCount: 0,
      totalOnSiteMinutes: 0,
      leadTravelMinutes: null,
      routePointCount: 0,
    },
  };
}

function fmtMinutes(
  min: number | null,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (min == null) return "—";
  if (min < 60) return t("ticketDetail.siteVisitSummary.minutes", { min });
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return t("ticketDetail.siteVisitSummary.hoursMinutes", { hr, min: rem });
}

function fmtTime(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale);
  } catch {
    return iso;
  }
}

type Props = {
  ticketId: number;
  refreshKey?: number | null;
};

export default function TicketSiteVisitSummary({ ticketId, refreshKey }: Props) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const brand = useBrand();
  const [data, setData] = useState<SiteVisitSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyView,setHistoryView] = useState(false);
  const [visitDate,setVisitDate] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<SiteVisitSummary>(`/api/tickets/${ticketId}/site-visit-summary`)
      .then((json) => {
        if (!cancelled) {
          setData(normalizeSiteVisitSummary(json));
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(
            e instanceof Error ? e.message : t("ticketDetail.siteVisitSummary.failed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey, t]);

  const lead = data?.people.find((p) => p.role === "lead");
  const routePoints = useMemo(
    () =>
      (data?.route ?? []).map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt,
      })),
    [data?.route],
  );

  return (
    <View style={styles.wrap} testID="site-visit-summary">
      <Text style={[styles.title, { color: colors.foreground }]}>
        {t("ticketDetail.siteVisitSummary.title")}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {t("ticketDetail.siteVisitSummary.subtitle")}
      </Text>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, marginLeft: 8 }}>
            {t("ticketDetail.siteVisitSummary.loading")}
          </Text>
        </View>
      ) : error ? (
        <Text style={{ color: colors.mutedForeground }}>{error}</Text>
      ) : !data ? null : (
        <>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:12}}>
            <TicketWorkAction label="Visit" icon="map-pin" active={!historyView} testID="ticket-map-visit" onPress={()=>setHistoryView(false)}/>
            <TicketWorkAction label="History & Replay" icon="clock" active={historyView} testID="ticket-map-history" onPress={()=>setHistoryView(true)}/>
          </View>
          {historyView ? <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:12}}>
            <TicketWorkAction label="All recorded days" icon="calendar" active={!visitDate} testID="ticket-map-all-days" onPress={()=>setVisitDate(null)}/>
            {[...new Set(routePoints.map(point=>point.recordedAt.slice(0,10)))].sort().map(date=><TicketWorkAction key={date} label={date} icon="calendar" active={visitDate===date} testID={"ticket-map-date-"+date} onPress={()=>setVisitDate(date)}/>)}
          </View> : null}
          <TicketRouteMap
            site={
              data.site
                ? {
                    latitude: data.site.latitude,
                    longitude: data.site.longitude,
                    name: data.site.name,
                  }
                : null
            }
            checkIn={
              lead?.checkInLatitude != null && lead.checkInLongitude != null
                ? {
                    latitude: lead.checkInLatitude,
                    longitude: lead.checkInLongitude,
                    time: lead.checkInAt ?? data.timeline.checkInTime,
                  }
                : null
            }
            checkOut={
              lead?.checkOutLatitude != null && lead.checkOutLongitude != null
                ? {
                    latitude: lead.checkOutLatitude,
                    longitude: lead.checkOutLongitude,
                    time: lead.checkOutAt ?? data.timeline.checkOutTime,
                  }
                : null
            }
            tracking={historyView && visitDate ? routePoints.filter(point=>point.recordedAt.startsWith(visitDate)) : routePoints}
            people={data.people.flatMap(person=>person.checkInLatitude != null && person.checkInLongitude != null ? [{id:person.key,latitude:person.checkInLatitude,longitude:person.checkInLongitude,label:(person.employeeName ?? "Crew").slice(0,1),title:(person.employeeName ?? "Crew")+" · recorded check-in",color:brand.primary}] : [])}
            onPersonPress={setSelectedKey}
            height={width >= 768 ? 500 : 340}
            siteRadiusMeters={data.site?.siteRadiusMeters}
          />

          <Text style={{color:colors.mutedForeground,marginVertical:8}}>Recorded visit locations · these are not live crew positions</Text>
          <Text style={{color:colors.foreground,fontFamily:"Inter_600SemiBold",marginVertical:8}}>{t("tickets.askvActions.title")}</Text>
          <View testID="ticket-askv-actions" style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:12}}>
            {askVActionsForTicket(ticketId).filter(action => action.key !== "proof").map(action => <TicketWorkAction key={action.key} label={t(action.labelKey)} icon={action.icon} testID={`button-ticket-askv-${action.key}`} onPress={() => router.push(askVPromptRoute(action.prompt) as never)}/>)}
          </View>
          <View style={styles.statsRow}>
            <Stat
              label={t("ticketDetail.siteVisitSummary.onSiteCount")}
              value={String(data.totals.peopleCount)}
              colors={colors}
            />
            <Stat
              label={t("ticketDetail.siteVisitSummary.totalOnSite")}
              value={fmtMinutes(data.totals.totalOnSiteMinutes, t)}
              colors={colors}
            />
            <Stat
              label={t("ticketDetail.siteVisitSummary.travel")}
              value={fmtMinutes(data.totals.leadTravelMinutes, t)}
              colors={colors}
            />
            <Stat
              label={t("ticketDetail.siteVisitSummary.routePoints")}
              value={String(data.totals.routePointCount)}
              colors={colors}
            />
          </View>

          {data.site ? (
            <LayeredPillButton
              onPress={() =>
                openInMaps(
                  data.site!.latitude,
                  data.site!.longitude,
                  data.site!.name ?? t("tickets.siteLocationFallback", { defaultValue: "Site" }),
                )
              }
              height={40}
              style={{ marginTop: 12 }}
              testID="button-get-directions-site"
            >
              <Feather name="navigation" size={16} color="#ffffff" />
              <Text style={{ color: "#ffffff", fontFamily: "Inter_600SemiBold", marginLeft: 8 }}>
                {t("ticketDetail.siteVisitSummary.directionsToSite")}
              </Text>
            </LayeredPillButton>
          ) : null}

          <View style={[styles.peopleCard, { borderColor: brand.primary }]}>
            <Text style={[styles.peopleHeader, { color: colors.foreground }]}>
              {t("ticketDetail.siteVisitSummary.peopleOnSite")}
            </Text>
            {data.people.length === 0 ? (
              <Text style={[styles.emptyPeople, { color: colors.mutedForeground }]}>
                {t("ticketDetail.siteVisitSummary.noPeople")}
              </Text>
            ) : (
              data.people.map((person) => {
                const active = selectedKey === person.key;
                return (
                  <Pressable
                    key={person.key}
                    onPress={() => setSelectedKey(active ? null : person.key)}
                    style={[
                      styles.personRow,
                      { borderTopColor: colors.border },
                      active ? { backgroundColor: colors.muted } : null,
                    ]}
                    testID={`site-visit-person-${person.employeeId}`}
                  >
                    <View style={styles.personTop}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.personNameRow}>
                          <Text style={[styles.personName, { color: colors.foreground }]}>
                            {person.employeeName}
                          </Text>
                          <Text style={[styles.roleBadge, { color: colors.mutedForeground }]}>
                            {person.role === "lead"
                              ? t("ticketDetail.siteVisitSummary.lead")
                              : t("ticketDetail.siteVisitSummary.crew")}
                          </Text>
                        </View>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                          {fmtMinutes(person.onSiteMinutes, t)} ·{" "}
                          {person.checkInAt ? fmtTime(person.checkInAt, i18n.language) : "—"}
                          {person.checkOutAt
                            ? ` → ${fmtTime(person.checkOutAt, i18n.language)}`
                            : ` · ${t("crew.live")}`}
                        </Text>
                      </View>
                      {person.insideGeofence === true ? (
                        <Feather name="check-circle" size={16} color="#059669" />
                      ) : person.insideGeofence === false ? (
                        <Feather name="alert-triangle" size={16} color="#d97706" />
                      ) : null}
                    </View>
                    {active ? (
                      <View style={styles.personDetail}>
                        {person.travelMinutes != null ? (
                          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                            {t("ticketDetail.siteVisitSummary.travel")}:{" "}
                            {fmtMinutes(person.travelMinutes, t)}
                          </Text>
                        ) : null}
                        {person.checkInDistanceMeters != null ? (
                          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                            {t("ticketDetail.siteVisitSummary.checkInDistance", {
                              m: person.checkInDistanceMeters,
                            })}
                          </Text>
                        ) : null}
                        <View style={styles.actionRow}>
                          {person.replayDate ? (
                            <Pressable
                              style={[styles.actionBtn, { borderColor: brand.primary }]}
                              onPress={() =>
                                router.push(
                                  `/crew-replay/${person.employeeId}?date=${person.replayDate}`,
                                )
                              }
                            >
                              <Feather name="map" size={12} color={colors.foreground} />
                              <Text style={[styles.actionText, { color: colors.foreground }]}>
                                {t("ticketDetail.siteVisitSummary.routeReplay")}
                              </Text>
                            </Pressable>
                          ) : null}
                          {person.checkInLatitude != null && person.checkInLongitude != null ? (
                            <Pressable
                              style={[styles.actionBtn, { borderColor: brand.primary }]}
                              onPress={() =>
                                openInMaps(person.checkInLatitude!, person.checkInLongitude!)
                              }
                            >
                              <Feather name="navigation" size={12} color={colors.foreground} />
                              <Text style={[styles.actionText, { color: colors.foreground }]}>
                                {t("ticketDetail.siteVisitSummary.checkInPin")}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>

          {data.timeline.enRouteAt ? (
            <View style={styles.timelineRow}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {t("ticketDetail.siteVisitSummary.enRoute")}:{" "}
                {fmtTime(data.timeline.enRouteAt, i18n.language)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {t("ticketDetail.siteVisitSummary.arrived")}:{" "}
                {fmtTime(data.timeline.arrivedAt, i18n.language)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {t("ticketDetail.siteVisitSummary.checkIn")}:{" "}
                {fmtTime(data.timeline.checkInTime, i18n.language)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {t("ticketDetail.siteVisitSummary.checkOut")}:{" "}
                {fmtTime(data.timeline.checkOutTime, i18n.language)}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function Stat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  const brand = useBrand();
  return (
    <View style={[styles.stat, { borderColor: brand.primary }]}>
      <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 4 },
  subtitle: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  loadingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  stat: {
    flexGrow: 1,
    flexBasis: "45%",
    borderWidth: 2,
    borderRadius: 14,
    padding: 8,
  },
  peopleCard: { borderWidth: 2, borderRadius: 14, overflow: "hidden", marginTop: 12 },
  peopleHeader: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  emptyPeople: { padding: 12, fontSize: 13 },
  personRow: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  personTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  personNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  personName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  roleBadge: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  personDetail: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  actionText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  timelineRow: { marginTop: 10, gap: 4 },
});
