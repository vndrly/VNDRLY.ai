import React, { useState, useRef } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  GatePage,
  GateCard,
  GateRow,
  GateField,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
type Site = {
  id: number;
  name: string;
  partnerId: number;
  partnerName?: string;
  gateLinkId?: string;
  gateLinkName?: string;
};
type Gate = {
  id: string;
  siteId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  version: number;
};
type Change = {
  path: string;
  body: Record<string, unknown>;
  description: string;
};
export default function Setup() {
  const { user, activeMembershipId } = useAuth();
  return <Panel key={user?.id + ":" + activeMembershipId} />;
}
function Panel() {
  const c = useGateCopy(),
    { user } = useAuth(),
    [siteId, setSite] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [showSites, setShowSites] = useState(true),
    [editing, setEditing] = useState<Partial<Gate> | null>(null),
    [lat, setLat] = useState(""),
    [lng, setLng] = useState(""),
    [target, setTarget] = useState<number | null>(null),
    [linkName, setLinkName] = useState(""),
    [review, setReview] = useState<Change | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const lock = useRef(false);
  const sites = useGateQuery<{ sites: Site[] }>(
    "/api/gate-change-over/station-management/sites",
  );
  const gates = useGateQuery<{ stations: Gate[] }>(
    "/api/gate-change-over/station-management/stations?siteId=" + siteId,
    !!siteId,
  );
  const linked = useGateQuery<{
    groupId: string | null;
    name: string | null;
    gates: {
      id: string;
      siteName: string;
      name: string;
      active: boolean;
      connection: string;
    }[];
  }>("/api/gate-change-over/linked-gates?siteId=" + siteId, !!siteId);
  const site = sites.data?.sites.find((s) => s.id === siteId);
  function edit(g?: Gate) {
    setEditing(g ?? { name: "" });
    setLat(g?.latitude?.toString() ?? "");
    setLng(g?.longitude?.toString() ?? "");
    setError("");
    setSaved("");
  }
  function prepare() {
    if (!editing || !siteId) return;
    const name = editing.name?.trim();
    if (
      !name ||
      !lat.trim() ||
      !lng.trim() ||
      !Number.isFinite(Number(lat)) ||
      Math.abs(Number(lat)) > 90 ||
      !Number.isFinite(Number(lng)) ||
      Math.abs(Number(lng)) > 180
    ) {
      setError(
        c(
          "Enter a gate name and valid latitude and longitude.",
          "Ingresa un nombre y coordenadas válidas.",
        ),
      );
      return;
    }
    setReview({
      path: editing.id ? "/stations/" + editing.id + "/location" : "/stations",
      body: {
        siteId,
        name,
        location: { latitude: Number(lat), longitude: Number(lng) },
        ...(editing.id
          ? { expectedVersion: editing.version, operationId: randomUUID() }
          : {}),
      },
      description: name + " · " + lat + ", " + lng,
    });
  }
  async function save() {
    if (!review || lock.current) return;
    const scope = captureAuthScope();
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        "/api/gate-change-over" + review.path,
        { method: "POST", body: JSON.stringify(review.body) },
        scope,
      );
      if (!isAuthScopeCurrent(scope)) return;
      setReview(null);
      setEditing(null);
      setTarget(null);
      const results = await Promise.all([
        sites.refetch(),
        gates.refetch(),
        linked.refetch(),
      ]);
      if (results.some((r) => r.error)) {
        setError(
          c(
            "The change was saved, but refresh failed. Refresh before making another change.",
            "Se guardó el cambio, pero falló la actualización. Actualiza antes de continuar.",
          ),
        );
        return;
      }
      setSaved(
        c(
          "Saved and refreshed from the server.",
          "Guardado y actualizado desde el servidor.",
        ),
      );
    } catch (e) {
      if (isAuthScopeCurrent(scope))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  }
  return (
    <GatePage
      title={c("Site setup and linked gates", "Sitios y accesos vinculados")}
      back
    >
      <GateError
        message={
          error ||
          sites.error?.message ||
          gates.error?.message ||
          linked.error?.message
        }
        retry={() => {
          void sites.refetch();
          if (siteId) {
            void gates.refetch();
            void linked.refetch();
          }
        }}
      />
      {saved && <Text style={gateStyle.text}>{saved}</Text>}
      {review ? (
        <GateCard
          title={c("Review change", "Revisar cambio")}
          icon="check-circle"
        >
          <Text style={gateStyle.text}>{site?.name}</Text>
          <Text style={gateStyle.text}>{review.description}</Text>
          <Text style={gateStyle.muted}>
            {c(
              "The server checks current site authority and gate state before saving.",
              "El servidor verifica los permisos y el estado actual antes de guardar.",
            )}
          </Text>
          <TogglePillButton disabled={busy} onPress={() => void save()}>
            {c("Confirm and save", "Confirmar y guardar")}
          </TogglePillButton>
          <TogglePillButton disabled={busy} onPress={() => setReview(null)}>
            {c("Cancel", "Cancelar")}
          </TogglePillButton>
        </GateCard>
      ) : (
        <>
          <GateCard
            title={c("Authorized sites", "Sitios autorizados")}
            icon="map-pin"
          >
            <GateRow
              label={site?.name ?? c("Choose site", "Elegir sitio")}
              onPress={() => setShowSites(!showSites)}
            />
            {sites.isLoading && <GateLoading />}
            {showSites && (
              <>
                <GateField
                  label={c("Find site", "Buscar sitio")}
                  value={search}
                  onChangeText={setSearch}
                />
                {sites.data?.sites
                  .filter((s) =>
                    s.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((s) => (
                    <GateRow
                      key={s.id}
                      label={s.name}
                      detail={s.partnerName}
                      onPress={() => {
                        setSite(s.id);
                        setShowSites(false);
                        setEditing(null);
                        setTarget(null);
                        setError("");
                        setSaved("");
                      }}
                    />
                  ))}
              </>
            )}
            {sites.isSuccess && !sites.data.sites.length && (
              <Text style={gateStyle.muted}>
                {c(
                  "No sites are available for management in this company context.",
                  "No hay sitios administrables en este contexto.",
                )}
              </Text>
            )}
          </GateCard>
          {site && (
            <>
              <GateCard
                title={c("Physical gates", "Accesos físicos")}
                icon="log-in"
              >
                {gates.isLoading && <GateLoading />}
                {gates.data?.stations.map((g) => (
                  <GateRow
                    key={g.id}
                    label={g.name}
                    detail={
                      g.latitude == null
                        ? c("Position needed", "Falta ubicación")
                        : g.latitude + ", " + g.longitude
                    }
                    onPress={() => edit(g)}
                  />
                ))}
                <GateRow
                  label={c("Add gate", "Agregar acceso")}
                  icon="plus"
                  onPress={() => edit()}
                />
                {editing && (
                  <View style={{ gap: 12 }}>
                    <GateField
                      label={c("Gate name", "Nombre del acceso")}
                      value={editing.name ?? ""}
                      onChangeText={(name) => setEditing({ ...editing, name })}
                    />
                    <GateField
                      label={c("Latitude", "Latitud")}
                      value={lat}
                      onChangeText={setLat}
                    />
                    <GateField
                      label={c("Longitude", "Longitud")}
                      value={lng}
                      onChangeText={setLng}
                    />
                    <TogglePillButton onPress={prepare}>
                      {c("Review location", "Revisar ubicación")}
                    </TogglePillButton>
                    {editing.id && (
                      <TogglePillButton
                        onPress={() =>
                          setReview({
                            path: "/stations/" + editing.id + "/retire",
                            body: {
                              siteId,
                              expectedVersion: editing.version,
                              operationId: randomUUID(),
                            },
                            description:
                              c("Retire gate: ", "Retirar acceso: ") +
                              editing.name,
                          })
                        }
                      >
                        {c("Retire gate", "Retirar acceso")}
                      </TogglePillButton>
                    )}
                    <TogglePillButton onPress={() => setEditing(null)}>
                      {c("Cancel", "Cancelar")}
                    </TogglePillButton>
                  </View>
                )}
              </GateCard>
              <GateCard
                title={c("Linked gates", "Accesos vinculados")}
                icon="link"
              >
                <Text style={gateStyle.muted}>
                  {c(
                    "Linked sites share Gate visibility only where each employee already has access. Linking never grants site access or starts a watch.",
                    "Los sitios vinculados comparten visibilidad solo donde cada empleado ya tiene acceso. Vincular no otorga acceso ni inicia una guardia.",
                  )}
                </Text>
                {linked.data?.gates.map((g) => (
                  <Text key={g.id} style={gateStyle.text}>
                    {g.siteName} · {g.name} ·{" "}
                    {g.active ? g.connection : c("Inactive", "Inactivo")}
                  </Text>
                ))}
                <GateField
                  label={c("Link name", "Nombre del vínculo")}
                  value={linkName}
                  onChangeText={setLinkName}
                />
                {sites.data?.sites
                  .filter(
                    (s) => s.id !== siteId && s.partnerId === site.partnerId,
                  )
                  .map((s) => (
                    <GateRow
                      key={s.id}
                      label={(target === s.id ? "✓ " : "") + s.name}
                      onPress={() => setTarget(s.id)}
                    />
                  ))}
                <TogglePillButton
                  disabled={!target}
                  onPress={() =>
                    setReview({
                      path: "/site-link",
                      body: {
                        siteId,
                        targetSiteId: target,
                        ...(linkName.trim() ? { name: linkName.trim() } : {}),
                      },
                      description:
                        c("Link with ", "Vincular con ") +
                        sites.data?.sites.find((s) => s.id === target)?.name,
                    })
                  }
                >
                  {c("Review link", "Revisar vínculo")}
                </TogglePillButton>
              </GateCard>
              {user?.role === "admin" && (
                <GateCard
                  title={c("Site operations", "Operaciones del sitio")}
                  icon="briefcase"
                >
                  <GateRow
                    label={c(
                      "Gate contractor designations",
                      "Designaciones de contratistas de acceso",
                    )}
                    onPress={() =>
                      router.push(
                        ("/site-gate-contractors?siteId=" + siteId) as never,
                      )
                    }
                  />
                </GateCard>
              )}
            </>
          )}
        </>
      )}
    </GatePage>
  );
}
