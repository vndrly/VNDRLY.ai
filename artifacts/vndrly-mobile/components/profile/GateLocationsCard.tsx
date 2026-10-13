import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, Pressable, ScrollView, Modal, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { captureGatePosition } from "@/lib/gate-location-capture";
import { randomUUID } from "expo-crypto";
import { Feather } from "@expo/vector-icons";
import LayeredPillButton from "@/components/LayeredPillButton";
import TogglePillButton from "@/components/TogglePillButton";
import MapboxNativeMap from "@/components/MapboxNativeMap";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";

type Gate = {
  id: string;
  siteId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  active: boolean;
  version: number;
};
type Values = Omit<Gate, "id" | "version" | "latitude" | "longitude"> & {
  id?: string;
  version?: number;
  latitude: number;
  longitude: number;
};
type Draft = {
  id?: string;
  version?: number;
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  active: boolean;
};
type Review = { values: Values; confirmation: string; idempotencyKey: string };
export default function GateLocationsCard() {
  const { user, activeMembershipId } = useAuth();
  if (user?.role !== "vendor" || !user.vendorId || user.managedSubcontractor || ["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "")) return null;
  // A membership change unmounts all draft/review/request state immediately.
  return <GateLocationsPanel key={`${user.id}:${activeMembershipId}:${user.vendorId}`} />;
}
function GateLocationsPanel() {
  const { t } = useTranslation(),
    colors = useColors();
  const { width } = useWindowDimensions();
  const [sitePicker, setSitePicker] = useState(false), [siteSearch, setSiteSearch] = useState(""), [manualPosition, setManualPosition] = useState(false);
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]),
    [siteId, setSiteId] = useState<number | null>(null);
  const [gates, setGates] = useState<Gate[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const locationRequest = useRef<AbortController|null>(null);
  const [locating,setLocating] = useState(false);
  useEffect(()=>()=>{locationRequest.current?.abort();locationRequest.current=null;},[]);
  function cancelLocation(){locationRequest.current?.abort();locationRequest.current=null;setLocating(false);}
  function closeEditor(){cancelLocation();setDraft(null);setReview(null);setError("");}
  async function locate(){
    if(locationRequest.current){cancelLocation();return;}
    const controller=new AbortController();locationRequest.current=controller;setLocating(true);setError("");
    try{const coords=await captureGatePosition(controller.signal);if(locationRequest.current===controller)setDraft(current=>current?{...current,latitude:String(coords.latitude),longitude:String(coords.longitude)}:null);}
    catch(error){if(locationRequest.current===controller&&!controller.signal.aborted){setError(t(error instanceof Error&&error.message==="denied"?"gateLocations.locationDenied":"gateLocations.locationTimeout"));setManualPosition(true);}}
    finally{if(locationRequest.current===controller){locationRequest.current=null;setLocating(false);}}
  }
  useEffect(() => {
    let live = true;
    apiFetch<{ capabilities?: { canManageGateLocations?: boolean } }>(
      "/api/work-hub/home",
    )
      .then((r) => {
        if (live) setAllowed(r.capabilities?.canManageGateLocations === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await work();
    } catch {
      setError(t("gateLocations.error"));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function loadGates(id: number) {
    setGates(
      (await apiFetch<{ gates: Gate[] }>(`/api/gate-locations?siteId=${id}`))
        .gates,
    );
  }
  function edit(gate?: Gate) {
    cancelLocation();
    setManualPosition(false);
    setReview(null);
    setSaved(false);
    setDraft(
      gate
        ? {
            id: gate.id,
            version: gate.version,
            name: gate.name,
            latitude: gate.latitude?.toString() ?? "",
            longitude: gate.longitude?.toString() ?? "",
            radius: String(gate.geofenceRadiusM),
            active: gate.active,
          }
        : {
            name: "",
            latitude: "",
            longitude: "",
            radius: "500",
            active: true,
          },
    );
  }
  function values(): Values | null {
    if (
      !draft ||
      !siteId ||
      !draft.name.trim() ||
      !draft.latitude.trim() ||
      !draft.longitude.trim() ||
      !draft.radius.trim()
    )
      return null;
    const latitude = Number(draft.latitude),
      longitude = Number(draft.longitude),
      geofenceRadiusM = Number(draft.radius);
    if (
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      !Number.isInteger(geofenceRadiusM) ||
      geofenceRadiusM < 1 ||
      geofenceRadiusM > 10000
    )
      return null;
    return {
      ...(draft.id ? { id: draft.id, version: draft.version } : {}),
      siteId,
      name: draft.name.trim(),
      latitude,
      longitude,
      geofenceRadiusM,
      active: draft.active,
    };
  }
  const previewValues = review?.values ?? values();
  if (!allowed) return null;
  return (
    <View style={styles.card} testID="gate-locations-card">
      <LayeredPillButton height={40} style={{ alignSelf: "stretch" }}
        disabled={busy}
        onPress={() =>
          run(async () => {
            if (!open)
              setSites(
                (
                  await apiFetch<{ sites: typeof sites }>(
                    "/api/gate-locations/sites",
                  )
                ).sites,
              );
            setOpen(!open);
          })
        }
      >
        <Feather name="map-pin" size={16} color="#ffffff" />
        <Text style={styles.actionText}>{t("gateLocations.title")}</Text>
        <Feather name="chevron-right" size={18} color="#ffffff" style={{ marginLeft: "auto" }} />
      </LayeredPillButton>
      {open ? (
        <View
          style={[
            styles.panel,
            { backgroundColor: colors.card, borderColor: colors.primary },
          ]}
        >
          <Text style={{ color: colors.text }}>
            {t("gateLocations.description")}
          </Text>
          {!sites.length ? (
            <Text style={{ color: colors.text }}>
              {t("gateLocations.noSites")}
            </Text>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Choose site" accessibilityState={{expanded:sitePicker}} disabled={busy} onPress={()=>setSitePicker(!sitePicker)} style={[styles.input,{borderColor:colors.primary,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}]}><View style={{gap:4}}><Text style={{color:colors.mutedForeground,fontSize:12}}>Site location</Text><Text style={{color:colors.text,fontWeight:"700"}}>{sites.find(site=>site.id===siteId)?.name??"Choose a site"}</Text></View><Feather name={sitePicker?"chevron-up":"chevron-down"} size={18} color={colors.primary}/></Pressable>
          {sitePicker&&<View style={{gap:8}}><TextInput accessibilityLabel="Search sites" placeholder="Search authorized sites" placeholderTextColor={colors.mutedForeground} value={siteSearch} onChangeText={setSiteSearch} style={[styles.input,{borderColor:colors.primary,color:colors.text}]}/><ScrollView style={{maxHeight:240}}>{sites.filter(site=>site.name.toLowerCase().includes(siteSearch.trim().toLowerCase())).map(site=><Pressable key={site.id} accessibilityRole="button" accessibilityLabel={site.name} disabled={busy} onPress={()=>run(async()=>{await loadGates(site.id);setSiteId(site.id);setDraft(null);setReview(null);setSitePicker(false);})} style={{padding:14,minHeight:44,borderBottomWidth:1,borderBottomColor:colors.border}}><Text style={{color:site.id===siteId?colors.primary:colors.text}}>{site.name}</Text></Pressable>)}</ScrollView></View>}
          {siteId&&<><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:10}}><Text style={{color:colors.mutedForeground}}>{gates.length} {gates.length===1?"gate":"gates"}</Text><TogglePillButton compactOnTablet solid disabled={busy} onPress={()=>edit()}>{t("gateLocations.add")}</TogglePillButton></View>{!gates.length&&<Text style={{color:colors.mutedForeground}}>No gates yet. Add the first entry point for this site.</Text>}{gates.map(gate=><View key={gate.id} style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:12,padding:14,borderWidth:2,borderColor:colors.primary,borderRadius:14}}><View style={{flex:1,gap:5}}><Text style={{color:colors.text,fontWeight:"700",fontSize:16}}>{gate.name}</Text><Text style={{color:colors.mutedForeground,fontSize:12}}>{t(gate.active?"gateLocations.active":"gateLocations.inactive")} · {gate.latitude==null||gate.longitude==null?"Position needed":gate.geofenceRadiusM+" m boundary"}</Text></View><TogglePillButton compactOnTablet accessibilityLabel={t("gateLocations.edit")+": "+gate.name} disabled={busy} onPress={()=>edit(gate)}>{t("gateLocations.edit")}</TogglePillButton></View>)}</>}
          <Modal visible={!!draft} transparent animationType="fade" onRequestClose={()=>{if(!busy)closeEditor();}}><View style={{flex:1,backgroundColor:"rgba(0,0,0,0.65)",justifyContent:"center",alignItems:"center",padding:16}}><View style={{width:"100%",maxWidth:780,maxHeight:"94%",borderWidth:2,borderColor:colors.primary,borderRadius:18,backgroundColor:colors.card,overflow:"hidden"}}><View style={{padding:18,flexDirection:"row",justifyContent:"space-between",alignItems:"center",borderBottomWidth:1,borderBottomColor:colors.border}}><View style={{gap:4}}><Text style={{color:colors.text,fontSize:20,fontWeight:"700"}}>{review?"Review gate":draft?.id?"Edit gate":"Add gate"}</Text><Text style={{color:colors.mutedForeground}}>{sites.find(site=>site.id===siteId)?.name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cancel gate edit" disabled={busy} onPress={closeEditor} style={{padding:10}}><Feather name="x" size={22} color={colors.text}/></Pressable></View><ScrollView contentContainerStyle={{padding:18,gap:14}}>
          {draft && !review ? (
            <>
              {(
                [
                  ["name", "name"],
                                    ["radius", "radius"],
                ] as const
              ).map(([key, label]) => (
                <View key={key}>
                  <Text style={{ color: colors.text }}>
                    {t(`gateLocations.${label}`)}
                  </Text>
                  <TextInput
                    accessibilityLabel={t(`gateLocations.${label}`)}
                    value={draft[key]}
                    editable={!busy}
                    onChangeText={(value) =>
                      setDraft({ ...draft, [key]: value })
                    }
                    style={[
                      styles.input,
                      { color: colors.text, borderColor: colors.primary },
                    ]}
                  />
                </View>
              ))}
              <Text style={{color:colors.mutedForeground}}>Stand at the gate to capture its position, or enter coordinates.</Text>
              <View style={{flexDirection:"row",gap:10,flexWrap:"wrap"}}>
              <TogglePillButton compactOnTablet solid
                disabled={busy}
                onPress={locate}
              >
                {locating?t("gateLocations.cancelLocation"):t("gateLocations.currentLocation")}
              </TogglePillButton>
              <TogglePillButton compactOnTablet disabled={busy} onPress={()=>{cancelLocation();setManualPosition(!manualPosition);}}>{manualPosition?"Hide coordinates":"Enter coordinates"}</TogglePillButton>
              </View>
              {manualPosition&&<View style={{flexDirection:width>=768?"row":"column",gap:10}}>{(["latitude","longitude"] as const).map(key=><View key={key} style={{flex:1,gap:6}}><Text style={{color:colors.text}}>{t("gateLocations."+key)}</Text><TextInput accessibilityLabel={t("gateLocations."+key)} value={draft[key]} editable={!busy} keyboardType="numbers-and-punctuation" onChangeText={value=>setDraft({...draft,[key]:value})} style={[styles.input,{borderColor:colors.primary,color:colors.text}]}/></View>)}</View>}
              {!!draft.latitude&&!!draft.longitude&&!manualPosition&&<Text style={{color:colors.mutedForeground}}>Position: {Number(draft.latitude).toFixed(5)}, {Number(draft.longitude).toFixed(5)}</Text>}

              <View style={{flexDirection:"row",gap:10,flexWrap:"wrap",justifyContent:"space-between"}}><TogglePillButton compactOnTablet
                disabled={busy}
                color={draft.active ? "red" : "green"}
                onPress={() => setDraft({ ...draft, active: !draft.active })}
              >
                {t(
                  draft.active
                    ? "gateLocations.deactivate"
                    : "gateLocations.reactivate",
                )}
              </TogglePillButton>
              <TogglePillButton compactOnTablet
                disabled={busy || locating || !values()}
                onPress={() =>
                  run(async () => {
                    const input = values();
                    if (!input) return;
                    const response = await apiFetch<{
                      values: Values;
                      confirmation: string;
                    }>("/api/gate-locations/preview", {
                      method: "POST",
                      body: JSON.stringify(input),
                    });
                    setReview({ ...response, idempotencyKey: randomUUID() });
                  })
                }
              >
                {t("gateLocations.review")}
              </TogglePillButton></View>
            </>
          ) : null}
          {previewValues ? (
            <View accessible accessibilityRole="image" accessibilityLabel={t("gateLocations.mapLabel", { name: previewValues.name, latitude: previewValues.latitude, longitude: previewValues.longitude, radius: previewValues.geofenceRadiusM })}>
            <MapboxNativeMap
              height={200}
              points={[{ id: "gate", ...previewValues, title: previewValues.name, label: previewValues.name }]}
              circles={[
                {
                  id: "radius",
                  ...previewValues,
                  radiusMeters: previewValues.geofenceRadiusM,
                },
              ]}
              center={[previewValues.longitude, previewValues.latitude]}
              zoom={13}
            />
            </View>
          ) : null}
          {review ? (
            <>
              <Text style={{ color: colors.text }}>
                {review.values.name} · {review.values.latitude},{" "}
                {review.values.longitude} · {review.values.geofenceRadiusM} m ·{" "}
                {t(
                  review.values.active
                    ? "gateLocations.active"
                    : "gateLocations.inactive",
                )}
              </Text>
              <TogglePillButton compactOnTablet
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    await apiFetch("/api/gate-locations", {
                      method: "POST",
                      body: JSON.stringify({
                        ...review.values,
                        confirmation: review.confirmation,
                        idempotencyKey: review.idempotencyKey,
                      }),
                    });
                    setReview(null);
                    setDraft(null);
                    setSaved(true);
                    await loadGates(review.values.siteId);
                  })
                }
              >
                {t("gateLocations.confirm")}
              </TogglePillButton>
              <TogglePillButton disabled={busy} onPress={() => setReview(null)}>
                {t("gateLocations.back")}
              </TogglePillButton>
            </>
          ) : null}
          {error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error}</Text>}
          </ScrollView></View></View></Modal>
          {saved ? (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              {t("gateLocations.saved")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error && !draft ? (
        <Text accessibilityRole="alert" style={{ color: colors.text, backgroundColor: colors.card, borderColor: colors.destructive, borderWidth: 1, borderRadius: 6, padding: 8 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, alignSelf: "stretch" },
  actionText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15, textShadowColor: "rgba(0, 0, 0, 0.63)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  panel: {
    padding: 12,
    gap: 10,
    borderWidth: 2,
    borderRadius: 14,
    marginTop: 8,
  },
  input: { borderWidth: 2, padding: 10, borderRadius: 10, minHeight: 44 },
});
