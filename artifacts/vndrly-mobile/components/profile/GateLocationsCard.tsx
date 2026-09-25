import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Location from "expo-location";
import { randomUUID } from "expo-crypto";
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
      <TogglePillButton
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
        {t("gateLocations.title")}
      </TogglePillButton>
      {open ? (
        <View
          style={[
            styles.panel,
            { backgroundColor: colors.card, borderColor: colors.border },
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
          {sites.map((site) => (
            <TogglePillButton
              key={site.id}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  setSiteId(site.id);
                  setDraft(null);
                  setReview(null);
                  await loadGates(site.id);
                })
              }
            >
              {site.name}
            </TogglePillButton>
          ))}
          {siteId ? (
            <>
              <Text style={{ color: colors.text }}>
                {sites.find((s) => s.id === siteId)?.name}
              </Text>
              {gates.map((gate) => (
                <View key={gate.id}>
                  <Text style={{ color: colors.text }}>
                    {gate.name} ·{" "}
                    {t(
                      gate.active
                        ? "gateLocations.active"
                        : "gateLocations.inactive",
                    )}
                  </Text>
                  <TogglePillButton disabled={busy} onPress={() => edit(gate)}>
                    {`${t("gateLocations.edit")}: ${gate.name}`}
                  </TogglePillButton>
                </View>
              ))}
              <TogglePillButton disabled={busy} onPress={() => edit()}>
                {t("gateLocations.add")}
              </TogglePillButton>
            </>
          ) : null}
          {draft && !review ? (
            <>
              {(
                [
                  ["name", "name"],
                  ["latitude", "latitude"],
                  ["longitude", "longitude"],
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
                      { color: colors.text, borderColor: colors.border },
                    ]}
                  />
                </View>
              ))}
              <TogglePillButton
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    const permission =
                      await Location.requestForegroundPermissionsAsync();
                    if (permission.status !== "granted") {
                      setError(t("gateLocations.locationDenied"));
                      return;
                    }
                    const { coords } = await Location.getCurrentPositionAsync(
                      {},
                    );
                    setDraft({
                      ...draft,
                      latitude: String(coords.latitude),
                      longitude: String(coords.longitude),
                    });
                  })
                }
              >
                {t("gateLocations.currentLocation")}
              </TogglePillButton>
              <TogglePillButton
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
              <TogglePillButton
                disabled={busy || !values()}
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
              </TogglePillButton>
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
              <TogglePillButton
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
          {saved ? (
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              {t("gateLocations.saved")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text, backgroundColor: colors.card, borderColor: colors.destructive, borderWidth: 1, borderRadius: 6, padding: 8 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  panel: {
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
  },
  input: { borderWidth: 1, padding: 10, borderRadius: 6, minHeight: 44 },
});
