import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Linking, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { notifyVoicePageContextChanged, registerVoicePageContext } from "@workspace/gate-booth";
import MapboxNativeMap from "@/components/MapboxNativeMap";
import type { MapCamera } from "@/components/MapCameraControls";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";
import { useGateSelection } from "@/lib/gate-selection";
import {
  LAST_COLOR, LIVE_COLOR, SAMPLE_COLOR, askVMapView, gatePosition, liveMapPoints, mapSummary, ownVisibility, parseSavedMapView,
  personPosition, personStatus, staffGroups, type LiveCoverage, type LiveStaff, type SavedMapView,
} from "@/lib/gate-live-map";
import { gateStyle } from "./GateCard";
import { useGateHeaderActions } from "./GateHeaderActions";

type Command = { key: number; center?: [number, number]; zoom?: number };
const miles = (a: [number, number], b: { latitude: number; longitude: number }) => {
  const r = Math.PI / 180, x = Math.sin(((b.latitude - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b.latitude * r) * Math.sin(((b.longitude - a[0]) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/**
 * The Gate Map as a native screen: the map, the worker's own position and the camera live in the app,
 * so nothing here is lost when iOS reloads an embedded page. Gate setup, dropped pins, history and
 * equipment stay in the website map behind "Map tools".
 */
export default function GateLiveMap({ onOpenTools }: { onOpenTools: () => void }) {
  const colors = useColors(), { i18n } = useTranslation(), es = !!i18n.language?.startsWith("es");
  const c = (en: string, spanish: string) => (es ? spanish : en);
  const { user, activeMembershipId } = useAuth();
  const params = useLocalSearchParams<{ staffUserId?: string; reveal?: string; stationId?: string }>();
  const header = useGateHeaderActions(), rememberedGate = useGateSelection(user, activeMembershipId);
  const { height: windowHeight } = useWindowDimensions();
  const storageKey = user ? `gate-live-map:${user.id}:${activeMembershipId ?? "none"}` : "";

  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const query = useQuery({
    queryKey: ["gate-live-map", user?.id, activeMembershipId],
    enabled: !!user,
    refetchInterval: focused ? 15000 : false,
    queryFn: () => changeOverRequest<LiveCoverage>("/coverage-map"),
  });
  const coverage = query.data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, [query.dataUpdatedAt]);

  // What the map remembers: where it was left, its style, and whether the roster was open.
  const [saved, setSaved] = useState<SavedMapView | null>(null);
  const view = useRef<SavedMapView>({ styleKind: "satellite", listOpen: false });
  useEffect(() => {
    let active = true;
    setSaved(null);
    if (storageKey) void AsyncStorage.getItem(storageKey).catch(() => null).then(raw => { if (active) { view.current = parseSavedMapView(raw); setSaved(view.current); } });
    return () => { active = false; };
  }, [storageKey]);
  const remember = (change: Partial<SavedMapView>) => {
    view.current = { ...view.current, ...change };
    // A camera move is only written down; it must not re-render the map it came from.
    if (!("camera" in change)) setSaved(current => (current ? { ...current, styleKind: view.current.styleKind, listOpen: view.current.listOpen } : current));
    if (storageKey) void AsyncStorage.setItem(storageKey, JSON.stringify(view.current)).catch(() => {});
  };

  // The worker's own dot comes from the phone itself, not from the page or the server.
  const [locationAllowed, setLocationAllowed] = useState<boolean | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const existing = await Location.getForegroundPermissionsAsync();
      const permission = existing.status === "undetermined" ? await Location.requestForegroundPermissionsAsync() : existing;
      if (active) setLocationAllowed(permission.status === "granted");
    })().catch(() => { if (active) setLocationAllowed(false); });
    return () => { active = false; };
  }, []);

  const [command, setCommand] = useState<Command>({ key: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const setMapFullscreen = header?.setMapFullscreen;
  useEffect(() => () => setMapFullscreen?.(false), [setMapFullscreen]);
  const points = useMemo(() => (coverage ? liveMapPoints(coverage, now, es) : []), [coverage, now, es]);
  const fitPoints = useMemo(() => (me ? [...points, { id: "me", latitude: me[1], longitude: me[0] }] : points), [points, me]);
  // The camera moves only when the person asks: a refresh never changes the command.
  const flyTo = (center: [number, number]) => setCommand(current => ({ key: current.key + 1, center, zoom: Math.max(15, view.current.camera?.zoom ?? 15) }));
  const focusPoint = (id: string) => {
    setSelected(id);
    const point = points.find(item => item.id === id);
    if (point) flyTo([point.longitude, point.latitude]);
  };

  // With nothing else to show and no remembered view, the first fix frames the worker instead of an empty country.
  const framedOnMe = useRef(false);
  useEffect(() => {
    if (!saved || saved.camera || !coverage || points.length || !me || framedOnMe.current) return;
    framedOnMe.current = true;
    flyTo(me);
  }, [saved, coverage, points.length, me]);

  // AskV asks for a person through the route; she is told only what the map really shows.
  const requested = askVMapView(params, coverage, query.isError && !coverage);
  const requestedView = useRef(requested);
  requestedView.current = requested;
  useEffect(() => registerVoicePageContext(() => ({ path: "/gate/map", title: "Gate Map", ...(requestedView.current ? { mapView: requestedView.current } : {}) })), []);
  useEffect(() => { notifyVoicePageContextChanged(); }, [requested?.target, requested?.state]);
  const handledRequest = useRef("");
  useEffect(() => {
    const request = params.staffUserId ? `staff:${params.staffUserId}` : params.reveal === "staff" ? "staff" : params.stationId ? `gate:${params.stationId}` : "";
    if (!coverage || !request || handledRequest.current === request) return;
    handledRequest.current = request;
    if (request === "staff") { setSelected(null); remember({ listOpen: true }); setCommand(current => ({ key: current.key + 1 })); }
    else focusPoint(request);
  }, [coverage, params.staffUserId, params.reveal, params.stationId]);

  if (!user) return null;
  const selectedPerson = selected?.startsWith("staff:") ? coverage?.staff.find(person => `staff:${person.userId}` === selected) : undefined;
  const selectedGate = selected?.startsWith("gate:") ? coverage?.gates.find(gate => `gate:${gate.id}` === selected) : undefined;
  const selectedPoint = points.find(point => point.id === selected);
  const own = coverage ? ownVisibility(coverage.staff, user.id, now, es) : null;
  const directions = (latitude: number, longitude: number) => void Linking.openURL(`http://maps.apple.com/?daddr=${latitude},${longitude}`);
  const dot = (person: LiveStaff) => ({ live: LIVE_COLOR, last: LAST_COLOR, sample: SAMPLE_COLOR, none: "#6b7280" })[personPosition(person)?.kind ?? "none"];
  const round = (icon: React.ComponentProps<typeof Feather>["name"], label: string, onPress: () => void, active = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#202428ee", borderWidth: 1.5, borderColor: active ? colors.primary : "#55585c" }}>
      <Feather name={icon} size={19} color={active ? colors.primary : "#f1f1f1"} />
    </Pressable>
  );
  const action = (label: string, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
  const stale = query.isError && !!coverage;

  return (
    <View testID="gate-live-map" style={{ flex: 1, padding: 10, paddingHorizontal: 2, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" }}>{c("Gate Map", "Mapa de accesos")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={c("Refresh map", "Actualizar mapa")} onPress={() => void query.refetch()} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: stale ? LAST_COLOR : coverage ? LIVE_COLOR : "#6b7280" }} />
          <Text numberOfLines={1} style={[gateStyle.muted, { flexShrink: 1 }]}>
            {stale ? c("Reconnecting · showing the last update", "Reconectando · se muestra la última actualización") : coverage ? c("Live · updates automatically", "En vivo · se actualiza solo") : c("Loading…", "Cargando…")}
          </Text>
        </Pressable>
        {action(c("Map tools", "Herramientas"), onOpenTools)}
      </View>

      {!expanded && !!coverage?.gates.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }} accessibilityLabel={c("Authorized gate locations", "Accesos autorizados")}>
          {coverage.gates.map(gate => {
            const staffed = coverage.duties.some(duty => duty.stationId === gate.id), id = `gate:${gate.id}`;
            return (
              <Pressable key={gate.id} accessibilityRole="button" accessibilityLabel={`${c("Show gate", "Mostrar acceso")} ${gate.name}`} accessibilityState={{ selected: selected === id }} disabled={!gatePosition(gate)}
                onPress={() => { rememberedGate.save(gate.siteId, gate.id); focusPoint(id); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 18, backgroundColor: "#242426", borderWidth: 1.5, borderColor: selected === id ? colors.primary : "#4a4d51", opacity: gatePosition(gate) ? 1 : 0.55 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: staffed ? LIVE_COLOR : "#6b7280" }} />
                <Text style={gateStyle.text}>{gate.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={{ flex: 1, minHeight: 180 }}>
        {query.isError && !coverage ? (
          <View style={[gateStyle.card, { borderColor: colors.primary }]}>
            <Text accessibilityRole="alert" style={gateStyle.text}>{query.error.message || c("The map could not be loaded.", "No se pudo cargar el mapa.")}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>{action(c("Try again", "Reintentar"), () => void query.refetch())}</View>
          </View>
        ) : !saved || !coverage ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : (
          <>
            <MapboxNativeMap controls showControls={false} height="100%" points={points} fitPoints={fitPoints} selectedPointId={selected}
              styleKind={saved.styleKind} initialCamera={saved.camera} center={command.center} zoom={command.zoom ?? 15} viewKey={String(command.key)} cameraAnimationDuration={600}
              userLocation={locationAllowed === true} onUserLocation={setMe} onCameraIdle={(camera: MapCamera) => remember({ camera })}
              onPointPress={setSelected} onMapPress={() => setSelected(null)} />
            <View pointerEvents="box-none" style={{ position: "absolute", top: 10, right: 10, flexDirection: "row", gap: 8 }}>
              {round("crosshair", c("Center on me", "Centrar en mí"), () => { if (me) flyTo(me); else if (locationAllowed === false) void Linking.openSettings(); })}
              {round("maximize", c("Fit everyone", "Ajustar a todos"), () => { setSelected(null); setCommand(current => ({ key: current.key + 1 })); })}
              {round("layers", saved.styleKind === "satellite" ? c("Show streets", "Ver calles") : c("Show satellite", "Ver satélite"), () => remember({ styleKind: saved.styleKind === "satellite" ? "street" : "satellite" }))}
              {round(expanded ? "minimize-2" : "maximize-2", expanded ? c("Close full map", "Cerrar mapa completo") : c("Full map", "Mapa completo"), () => { setExpanded(!expanded); setMapFullscreen?.(!expanded); }, expanded)}
            </View>
            {locationAllowed === false && (
              <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={{ position: "absolute", top: 62, left: 10, right: 10, padding: 10, borderRadius: 10, backgroundColor: "#202428ee" }}>
                <Text style={gateStyle.muted}>{c("Location is off for VNDRLY Gate, so your own position cannot be shown. Tap to open Settings.", "La ubicación está desactivada para VNDRLY Gate; no se puede mostrar su posición. Toque para abrir Ajustes.")}</Text>
              </Pressable>
            )}
            {locationAllowed && !me && <Text style={[gateStyle.muted, { position: "absolute", top: 62, left: 10, padding: 8, borderRadius: 10, backgroundColor: "#202428ee" }]}>{c("Finding your location…", "Buscando su ubicación…")}</Text>}
            {!points.length && <Text accessibilityRole="alert" style={[gateStyle.muted, { position: "absolute", bottom: 10, left: 10, right: 10, padding: 10, borderRadius: 10, backgroundColor: "#202428ee" }]}>{c("No gate has a saved position and no one is sharing a location yet.", "Ningún acceso tiene posición guardada y nadie comparte ubicación todavía.")}</Text>}
            {(selectedPerson || selectedGate || selectedPoint) && (
              <View testID="gate-live-map-detail" style={[gateStyle.card, { position: "absolute", left: 8, right: 8, bottom: 8, borderColor: colors.primary }]}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={gateStyle.title}>{selectedPerson?.name ?? selectedGate?.name ?? selectedPoint?.title}{selectedPerson?.userId === user.id ? c(" (you)", " (usted)") : ""}</Text>
                    {selectedPerson && <Text style={gateStyle.muted}>{selectedPerson.assignment}</Text>}
                    {selectedPerson && <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot(selectedPerson) }} /><Text style={gateStyle.text}>{personStatus(selectedPerson, now, es)}</Text></View>}
                    {selectedGate && <Text style={gateStyle.muted}>{selectedGate.siteName}</Text>}
                    {selectedGate && <Text style={gateStyle.text}>{(() => { const names = coverage.staff.filter(person => coverage.duties.some(duty => duty.stationId === selectedGate.id && duty.userId === person.userId)).map(person => person.name); return names.length ? c("On watch: ", "De guardia: ") + names.join(", ") : c("No one on watch", "Nadie de guardia"); })()}</Text>}
                    {me && selectedPoint && <Text style={gateStyle.muted}>{miles(me, selectedPoint).toFixed(1)} {c("mi from you · straight line", "mi de usted · línea recta")}</Text>}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={c("Close details", "Cerrar detalles")} onPress={() => setSelected(null)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={20} color="#ececec" /></Pressable>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {selectedPerson?.phone && action(c("Call", "Llamar"), () => void Linking.openURL(`tel:${selectedPerson.phone!.replace(/[^+0-9]/g, "")}`))}
                  {selectedPerson?.phone && action(c("Text", "Mensaje"), () => void Linking.openURL(`sms:${selectedPerson.phone!.replace(/[^+0-9]/g, "")}`))}
                  {selectedPoint && action(c("Directions", "Cómo llegar"), () => directions(selectedPoint.latitude, selectedPoint.longitude))}
                  {selectedGate && action(c("Open Gate", "Abrir acceso"), () => { rememberedGate.save(selectedGate.siteId, selectedGate.id); router.push("/gate"); })}
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {!expanded && coverage && saved && (
        <View style={[gateStyle.card, { borderColor: colors.primary, paddingTop: 8, paddingBottom: 8, gap: 4 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={c("People on the map", "Personas en el mapa")} accessibilityState={{ expanded: saved.listOpen }} onPress={() => remember({ listOpen: !saved.listOpen })} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
            <Feather name="users" size={19} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[gateStyle.text, { fontWeight: "700" }]}>{mapSummary(coverage.staff, es)}</Text>
              {own && <Text style={[gateStyle.muted, { color: own.visible ? LIVE_COLOR : "#b3b3b3" }]}>{own.text}</Text>}
            </View>
            <Feather name={saved.listOpen ? "chevron-down" : "chevron-up"} size={18} color={colors.primary} />
          </Pressable>
          {own && !own.visible && own.text.includes("Profile") && <View style={{ flexDirection: "row" }}>{action(c("Open Profile", "Abrir Perfil"), () => router.push("/(tabs)/profile"))}</View>}
          {saved.listOpen && (
            <ScrollView style={{ maxHeight: Math.max(150, windowHeight * 0.32) }} keyboardShouldPersistTaps="handled">
              {staffGroups(coverage, es).filter(group => group.people.length).map(group => (
                <View key={group.id}>
                  <Text style={[gateStyle.muted, { paddingTop: 8, paddingBottom: 2, fontWeight: "700" }]}>{group.title} · {group.people.length}</Text>
                  {group.people.map(person => (
                    <Pressable key={person.userId} accessibilityRole="button" accessibilityLabel={`${c("Show", "Mostrar")} ${person.name}`} accessibilityState={{ selected: selected === `staff:${person.userId}` }} onPress={() => focusPoint(`staff:${person.userId}`)} style={gateStyle.row}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot(person) }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[gateStyle.text, { fontWeight: "700" }]}>{person.name}{person.userId === user.id ? c(" (you)", " (usted)") : ""}</Text>
                        <Text style={gateStyle.muted}>{personStatus(person, now, es)} · {person.assignment}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}
              {!coverage.staff.length && <Text style={gateStyle.muted}>{c("No one with the app is listed for your gates yet.", "Aún no hay personas con la app en sus accesos.")}</Text>}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
