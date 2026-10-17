import {currentFleetPositions,fleetCurrentPhoneSpeed} from "@workspace/api-zod";
import React, { useState } from "react";
import { Text, View, Pressable, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type {
  FleetOverview,
  FleetResources,
  FleetRun,
  FleetLocationObservation,
} from "@workspace/api-zod";
import MapRouteReplay from "./MapRouteReplay";
import MapboxNativeMap from "./MapboxNativeMap";
import TogglePillButton from "./TogglePillButton";
import FleetCheckbox from "./FleetCheckbox";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { useFleetCopy } from "@/lib/fleet-copy";
import { fleetMapSelection } from "@/lib/fleet-map-selection";
type Place = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  address?: string;
  siteId?: number;
};
const valid = (
  p: Place | undefined,
): p is Place & { latitude: number; longitude: number } =>
  !!p &&
  p.latitude !== null &&
  p.longitude !== null &&
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 85 &&
  Math.abs(p.longitude) <= 180;
export default function FleetMapOverview(props: {
  overview: FleetOverview;
  resources: FleetResources;
  onOpen: (run: FleetRun) => void;
}) {
  const { user, activeMembershipId } = useAuth();
  return (
    <FleetMapPanel
      key={user?.id + ":" + activeMembershipId + ":" + props.overview.companyId}
      {...props}
    />
  );
}
function FleetMapPanel({
  overview,
  resources,
  onOpen,
}: {
  overview: FleetOverview;
  resources: FleetResources;
  onOpen: (run: FleetRun) => void;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    { user, activeMembershipId } = useAuth(),
    { height, width } = useWindowDimensions();
  const [siteId, setSiteId] = useState<number | null>(null),
    [ticketId, setTicketId] = useState<number | null>(null),
    [siteMenu, setSiteMenu] = useState(false),
    [ticketMenu, setTicketMenu] = useState(false),
    [fit, setFit] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [street, setStreet] = useState(true),
    [includeOld, setIncludeOld] = useState(false),
    [expanded, setExpanded] = useState(false);
  const context = useQuery({
    queryKey: [
      "fleet-map-context",
      user?.id,
      activeMembershipId,
      overview.companyId,
    ],
    queryFn: () =>
      apiFetch<{ company: Place; sites: Place[]; canManage: boolean }>(
        "/api/fleet/map-context",
      ),
    enabled: !!user,
  });
  const [mapMode, setMapMode] = useState<"live" | "history">("live"),
    [followDriver, setFollowDriver] = useState<number | null>(null),
    [replayRun, setReplayRun] = useState<string | null>(null);
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [cameraReset,setCameraReset]=useState(0);
  const history = useQuery({
    queryKey: [
      "fleet-route-history",
      user?.id,
      activeMembershipId,
      overview.companyId,
      replayRun,
    ],
    queryFn: () =>
      apiFetch<{
        points: FleetLocationObservation[];
        events: { id: string; recordedAt: string; label: string }[];
        truncated: boolean;
      }>(`/api/fleet/runs/${replayRun}/location-history`),
    refetchInterval: 15000,
    enabled: !!user && !!replayRun && mapMode === "history",
  });
  const company = context.data?.company,
    knownSiteIds = new Set([
      ...overview.fleets.flatMap((f) => f.siteIds),
      ...overview.runs.flatMap((run) =>
        run.commercial ? [run.commercial.originSiteId] : run.siteIds,
      ),
      ...(resources.tickets?.map((ticket) => ticket.siteId) ?? []),
    ]),
    sites = (context.data?.sites ?? []).filter((site) =>
      knownSiteIds.has(site.siteId!),
    ),
    site = sites.find((site) => site.siteId === siteId),
    place = site ?? company;
  const baseResources = {
    ...resources,
    equipment: resources.equipment.length
      ? resources.equipment
      : [
          ...new Map(
            overview.runs.map((run) => [
              run.vehicleAssetId,
              {
                id: run.vehicleAssetId,
                name: run.labels?.vehicleName ?? copy("Assigned vehicle"),
                category: "truck",
                status: "",
                dispatchable: false,
              },
            ]),
          ).values(),
        ],
    drivers: resources.drivers.length
      ? resources.drivers
      : [
          ...new Map(
            overview.runs.map((run) => [
              run.driverUserId,
              {
                userId: run.driverUserId,
                name: run.labels?.driverName ?? copy("Assigned driver"),
                fleetIds: [],
              },
            ]),
          ).values(),
        ],
  };
  const view = fleetMapSelection(overview, baseResources, siteId, ticketId),
    tickets = [
      ...new Set(
        overview.runs
          .filter(
            (run) =>
              siteId === null ||
              (run.commercial
                ? run.commercial.originSiteId === siteId
                : run.siteIds.includes(siteId)),
          )
          .map((run) => run.linkedTicketId)
          .filter((id): id is number => id !== null),
      ),
    ];
  const positions = currentFleetPositions(view.observations.map(point=>({...point,vehicleAssetId:point.vehicleAssetId??view.runs.find(run=>run.id===point.runId)?.vehicleAssetId??point.runId}))).sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt));
  const shownPositions = positions.filter(point => includeOld || point.freshness === "recent");
  const oldCount = positions.filter(point => point.freshness !== "recent").length;
  const pins = [
    ...(valid(place)
      ? [
          {
            id: "center",
            latitude: place.latitude,
            longitude: place.longitude,
            title: place.name,
            label: site ? "S" : "HQ",
            color: colors.primary,
          },
        ]
      : []),
    ...shownPositions.map((point, index) => {
      const run = view.runs.find(item => item.id === point.runId)!;
      return { id: point.vehicleAssetId ?? run.vehicleAssetId, latitude: point.latitude, longitude: point.longitude,
        title: `${run.labels?.vehicleName ?? copy("Assigned vehicle")} · ${run.labels?.driverName ?? copy("Assigned driver")} · ${new Date(point.recordedAt).toLocaleString()}`,
        label: String(index + 1), color: point.freshness === "recent" ? "#1E5BD0" : "#6b7280" };
    }),
  ];
  const field = {
    padding: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    backgroundColor: colors.card,
    gap: 6,
  };
  const followed =
    followDriver === null
      ? undefined
      : shownPositions.find(point => view.runs.find(run => run.id === point.runId)?.driverUserId === followDriver);
  const active = (run: FleetRun) =>
    !["completed", "cancelled"].includes(run.status);
  const row = (
    id: string,
    name: string,
    run: FleetRun | undefined,
    observation: FleetOverview["observations"][number] | undefined,
  ) => (
    <View
      style={{
        ...field,
        minWidth: width >= 768 ? 240 : undefined,
        flexGrow: 1,
        flexBasis: width >= 768 ? "45%" : undefined,
        borderColor: selected === id ? colors.primary : colors.border,
      }}
    >
      <Text
        style={{ color: colors.foreground, fontWeight: "700", fontSize: 17 }}
      >
        {name}
      </Text>
      <Text style={{ color: colors.foreground }}>
        {run
          ? run.title + " · " + copy(run.status.replaceAll("_", " "))
          : copy("Idle · no active run")}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {observation
          ? copy(
              observation.freshness === "recent"
                ? "Recent driver-phone location"
                : "Last-known driver-phone location",
            ) +
            " · " +
            new Date(observation.recordedAt).toLocaleString()
          : copy("No reported location")}
      </Text>
      {id.startsWith("driver-")&&<TogglePillButton compactOnTablet disabled={!observation} solid={followDriver===Number(id.slice(7))} onPress={()=>{setFollowDriver(Number(id.slice(7)));setMapMode("live");setSelected(run?.vehicleAssetId ?? id);}}>{`${copy("Follow")} · ${name}`}</TogglePillButton>}
      {run && (
        <TogglePillButton compactOnTablet onPress={() => onOpen(run)}>
          {`${copy("Open run")} · ${run.linkedTicketId
            ? copy("Ticket") + " #" + run.linkedTicketId
            : run.title}`}
        </TogglePillButton>
      )}
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: width >= 768 ? "row" : "column", gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy("Fleet site location")}
          accessibilityState={{ expanded: siteMenu }}
          onPress={() => setSiteMenu(!siteMenu)}
          style={{ ...field, flex: 1 }}
        >
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {copy("Site location")} ▾
          </Text>
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>
            {site?.name ?? copy("Company · all sites")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy("Fleet ticket filter")}
          accessibilityState={{ expanded: ticketMenu }}
          onPress={() => setTicketMenu(!ticketMenu)}
          style={{ ...field, flex: 1 }}
        >
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {copy("Ticket")} ▾
          </Text>
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>
            {ticketId ? copy("Ticket") + " #" + ticketId : copy("All tickets")}
          </Text>
        </Pressable>
      </View>
      {siteMenu && (
        <View style={field}>
          {[{ siteId: null, name: copy("Company · all sites") }, ...sites].map(
            (s) => (
              <Pressable
                key={String(s.siteId)}
                accessibilityRole="button"
                onPress={() => {
                  setSiteId(s.siteId ?? null);
                  setTicketId(null);
                  setSelected(null);
                  setFit(false);
                  setSiteMenu(false);
                }}
                style={{ padding: 12 }}
              >
                <Text style={{ color: colors.foreground }}>{s.name}</Text>
              </Pressable>
            ),
          )}
          {!sites.length && (
            <Text style={{ color: colors.mutedForeground }}>
              {copy("No Fleet sites configured yet.")}
            </Text>
          )}
        </View>
      )}
      {ticketMenu && (
        <View style={field}>
          {[null, ...tickets].map((id) => (
            <TogglePillButton
              compactOnTablet
              key={String(id)}
              onPress={() => {
                setTicketId(id);
                setTicketMenu(false);
                setSelected(null);
              }}
            >
              {id ? copy("Ticket") + " #" + id : copy("All tickets")}
            </TogglePillButton>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TogglePillButton
          compactOnTablet
          solid={mapMode === "live"}
          onPress={() => setMapMode("live")}
        >
          {copy("Live")}
        </TogglePillButton>
        <TogglePillButton
          compactOnTablet
          solid={mapMode === "history"}
          onPress={() => setMapMode("history")}
        >
          {copy("History & Replay")}
        </TogglePillButton>
      </View>
      {mapMode === "history" ? (
        <View style={{ gap: 10 }}>
          <TogglePillButton compactOnTablet accessibilityLabel="Choose recorded run" onPress={() => setRunPickerOpen(value => !value)}>{view.runs.find(run => run.id === replayRun)?.title ?? copy("Choose a recorded run")} ▾</TogglePillButton>
          {runPickerOpen && view.runs.map((run) => (
            <TogglePillButton
              compactOnTablet
              key={run.id}
              solid={replayRun === run.id}
              onPress={() => { setReplayRun(run.id); setRunPickerOpen(false); }}
            >
              {run.title} · {run.labels?.driverName ?? copy("Driver")} ·{" "}
              {new Date(
                run.events[0]?.recordedAt ?? Date.now(),
              ).toLocaleDateString()}
            </TogglePillButton>
          ))}
          {!view.runs.length && (
            <Text style={{ color: colors.mutedForeground }}>
              {copy("No runs in this view.")}
            </Text>
          )}
          {history.isLoading && (
            <Text style={{ color: colors.mutedForeground }}>
              {copy("Loading recorded route…")}
            </Text>
          )}
          {history.isError && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.destructive }}
            >
              {copy("Recorded route could not load.")}
            </Text>
          )}
          {history.data &&
            !history.isError &&
            view.runs.some((run) => run.id === replayRun) && (
              <MapRouteReplay
                key={replayRun}
                points={history.data.points}
                events={history.data.events}
                truncated={history.data.truncated}
                title={view.runs.find((run) => run.id === replayRun)?.title}
                runStatus={view.runs.find((run) => run.id === replayRun)?.status}
              />
            )}
        </View>
      ) : (
        <View>
          <View style={{ gap: 8, marginBottom: 10 }}><FleetCheckbox label={`${copy("Show stale / paused positions")} (${oldCount})`} checked={includeOld} onChange={setIncludeOld} /><TogglePillButton compactOnTablet onPress={() => setExpanded(value => !value)}>{copy(expanded ? "Collapse map" : "Expand map")}</TogglePillButton></View>
          <MapboxNativeMap
            controls
            viewKey={String(siteId) + ":" + ticketId + ":" + fit+":"+cameraReset}
            height={expanded ? Math.max(520, height - 100) : Math.max(360, Math.min(640, height - 260))}
            points={pins}
            center={
              followed
                ? [followed.longitude, followed.latitude]
                : !fit && valid(place)
                  ? [place.longitude, place.latitude]
                  : undefined
            }
            zoom={14}
            styleKind={street ? "street" : "satellite"}
            selectedPointId={selected}
            onPointPress={setSelected}
          />
          <View
            style={{
              position: "absolute",
              bottom: 30,
              left: 12,
              right: 12,
              flexDirection: "row",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <TogglePillButton
              compactOnTablet
              solid={!fit}
              onPress={() => {
                setFit(false);
                setFollowDriver(null);
                setCameraReset(value=>value+1);
              }}
            >
              {copy(site ? "Center site" : "Center company")}
            </TogglePillButton>
            <TogglePillButton
              compactOnTablet
              solid={fit}
              onPress={() => {
                setFit(true);
                setFollowDriver(null);
                setCameraReset(value=>value+1);
              }}
            >
              {copy("Fit drivers")}
            </TogglePillButton>
            <TogglePillButton
              compactOnTablet
              onPress={() => setStreet(!street)}
            >
              {copy(street ? "Satellite" : "Streets")}
            </TogglePillButton>
            {followDriver !== null && (
              <TogglePillButton
                compactOnTablet
                onPress={() => setFollowDriver(null)}
              >
                {copy("Stop following")}
              </TogglePillButton>
            )}
          </View>
        </View>
      )}
      {context.isError && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy("Company map context could not load.")}
        </Text>
      )}
      {!context.isLoading && !valid(place) && (
        <Text style={{ color: colors.mutedForeground }}>
          {copy(
            "No saved coordinates for this location. Showing the base map.",
          )}
        </Text>
      )}
      {mapMode === "live" && <>
      <Text style={{ color: colors.mutedForeground }}>{copy("Numbers match the map markers. Blue: recent. Grey: stale or paused.")}</Text>
      {!shownPositions.length && <Text style={{ color: colors.text }}>{copy("No recent positions in this view")}</Text>}
      {shownPositions.map((point, index) => {
        const run = view.runs.find(item => item.id === point.runId)!;
        return <Pressable key={point.vehicleAssetId ?? run.vehicleAssetId} accessibilityRole="button" accessibilityLabel={`${index + 1} · ${run.labels?.vehicleName ?? copy("Assigned vehicle")}`} onPress={() => { setSelected(point.vehicleAssetId ?? run.vehicleAssetId); setExpanded(false); onOpen(run); }} style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{index + 1} · {run.labels?.vehicleName ?? copy("Assigned vehicle")}</Text><Text style={{ color: colors.mutedForeground }}>{run.labels?.driverName ?? copy("Assigned driver")} · {run.title}</Text><Text style={{ color: colors.mutedForeground }}>{copy(point.freshness === "recent" ? "Recent" : "Stale / paused")} · {new Date(point.recordedAt).toLocaleString()}</Text></Pressable>;
      })}
      {company && !site && (
        <Text style={{ color: colors.mutedForeground }}>
          {company.name}
          {company.address ? " · " + company.address : ""}
        </Text>
      )}
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {copy(
          "Phone locations identify the reporting driver, not a verified truck position. Idle truck locations need a connected tracker.",
        )}
      </Text>
      <Text
        style={{ color: colors.foreground, fontWeight: "700", fontSize: 18 }}
      >
        {copy("Trucks & Trailers")} · {view.equipment.length}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {view.equipment.map((asset) => {
          const run = view.runs.find(
            (run) =>
              [run.vehicleAssetId, run.trailerAssetId].includes(asset.id) &&
              active(run),
          );
          return (
            <React.Fragment key={asset.id}>
              {row(
                asset.id,
                asset.name,
                run,
                view.observations.find((o) => o.vehicleAssetId === asset.id),
              )}
            </React.Fragment>
          );
        })}
      </View>
      {!view.equipment.length && (
        <Text style={{ color: colors.mutedForeground }}>
          {copy("No trucks or trailers in this view.")}
        </Text>
      )}
      <Text
        style={{ color: colors.foreground, fontWeight: "700", fontSize: 18 }}
      >
        {copy("Drivers")} · {view.drivers.length}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {view.drivers.map((driver) => {
          const run = view.runs.find(
            (run) => run.driverUserId === driver.userId && active(run),
          );
          return (
            <React.Fragment key={driver.userId}>
              {row(
                "driver-" + driver.userId,
                driver.name,
                run,
                view.observations.find(
                  (o) =>
                    view.runs.find((run) => run.id === o.runId)
                      ?.driverUserId === driver.userId,
                ),
              )}
            </React.Fragment>
          );
        })}
      </View>
      {!view.drivers.length && (
        <Text style={{ color: colors.mutedForeground }}>
          {copy("No drivers in this view.")}
        </Text>
      )}
      </>}
    </View>
  );
}
