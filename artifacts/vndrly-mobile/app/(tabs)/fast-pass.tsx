import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { FastPassIdentitySchema, type FastPassTripInput } from "@workspace/api-zod";
import { normalizePlateState } from "@workspace/plate-state";
import MapboxNativeMap from "@/components/MapboxNativeMap";
import { GateCard, GateError, GateField, GateLoading, GatePage, GateRow, gateStyle } from "@/components/gate/GateChrome";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { getDeviceConsentStatus } from "@/lib/locationConsent";
import { nativeUuid } from "@/lib/native-uuid";
import { fastPassApi, readFastPassTrip, reportFastPassPoint, startFastPassBackground, stopFastPassBackground, tripsApi, watchFastPassLocation, type FastPassTrip } from "@/lib/fast-pass";

type Identity = FastPassTripInput["identity"];
const fields: { key: keyof Identity; label: string }[] = [
  { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" },
  { key: "company", label: "Company" }, { key: "vehiclePlate", label: "Tag" },
  { key: "plateState", label: "Issuing state" }, { key: "notes", label: "Notes (optional)" },
];
type Options = {
  userId: number;
  owner: { type: "vendor" | "partner"; id: number };
  firstName: string; lastName: string; company: string;
  vehicles: { id: string; name: string; vehiclePlate: string; plateState: string }[];
  sites: { id: number; name: string; destinations: { id: string; name: string }[] }[];
};
type Coordinates = { latitude: number; longitude: number };
type Route = {
  origin: Coordinates;
  destination: Coordinates;
  estimate: { durationMinutes: number; distanceMiles: number; coordinates?: [number, number][] } | null;
};
type PastTrip = {
  id: string; site: string; vehicle: string | null; startedAt: string; completedAt: string | null;
  checkInTime: string | null; checkOutTime: string | null;
  fastPass: FastPassTrip["fastPass"];
};
type History = { trips: PastTrip[]; before: string | null };
const readableTime = (time: string) => new Date(time).toLocaleString();
const errorMessage = (failure: unknown, fallback: string) => {
  const status = (failure as { status?: number })?.status;
  return status === 403 ? "Fast Pass is unavailable for this account or location sharing is off." : fallback;
};

export default function FastPassScreen() {
  const { user } = useAuth();
  const account = [user?.id, user?.activeMembershipId, user?.vendorId, user?.partnerId].join(":");
  return <FastPassWorkspace key={account} account={account} />;
}

function FastPassWorkspace({ account }: { account: string }) {
  const queryClient = useQueryClient();
  const tripKey = ["fast-pass-trip", account];
  const tripQuery = useQuery({ queryKey: tripKey, queryFn: readFastPassTrip, refetchInterval: 8_000 });
  const trip = tripQuery.data;
  const options = useQuery({
    queryKey: ["fast-pass-options", account],
    queryFn: () => apiFetch<Options>(fastPassApi + "/options"),
    enabled: tripQuery.isSuccess && !trip,
  });
  const [vehicleId, setVehicleId] = useState("");
  const [destination, setDestination] = useState<{ siteId: number; id: string | null; title: string }>();
  const [patch, setPatch] = useState<Partial<Identity>>({});
  const [expanded, setExpanded] = useState<"truck" | "destination" | "details" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [tracking, setTracking] = useState<"starting" | "background" | "foreground" | "unavailable">("starting");
  const activeRequest = useRef(false);
  const requestId = useRef<string>(null);
  const background = useRef(false);
  const activeTripId = trip?.fastPass && trip.trackingState === "active" ? trip.id : null;
  const route = useQuery({
    queryKey: ["fast-pass-route", account, activeTripId, trip?.fastPass?.clearance?.gateId],
    queryFn: () => apiFetch<Route | null>(fastPassApi + "/" + activeTripId + "/route"),
    enabled: !!activeTripId && !!trip?.lastReliablePoint,
    refetchInterval: 30_000,
  });
  const history = useInfiniteQuery({
    queryKey: ["fast-pass-history", account],
    initialPageParam: "",
    queryFn: ({ pageParam }) => apiFetch<History>(fastPassApi + "/history" + (pageParam ? "?before=" + encodeURIComponent(pageParam) : "")),
    getNextPageParam: page => page.before ?? undefined,
    enabled: showHistory,
  });

  useEffect(() => {
    if (!activeTripId) return;
    const scope = captureAuthScope();
    let current = true;
    let subscription: Location.LocationSubscription | undefined;
    let sending = false;
    const report = async (sample: Location.LocationObject) => {
      if (!current || sending || !isAuthScopeCurrent(scope)) return;
      sending = true;
      try {
        const latest = await reportFastPassPoint(activeTripId, sample, scope);
        if (current && isAuthScopeCurrent(scope) && latest !== undefined) {
          queryClient.setQueryData(tripKey, latest);
          if (!latest) void queryClient.invalidateQueries({ queryKey: ["fast-pass-history", account] });
        }
      } catch (error) {
        if (current && (error as { status?: number }).status !== 409) {
          setMessage(errorMessage(error, "Location update couldn't reach the gate. The app will retry."));
        }
      } finally { sending = false; }
    };
    async function start() {
      if ((await Location.getForegroundPermissionsAsync()).status !== "granted" ||
          await getDeviceConsentStatus() !== "accepted") {
        if (current) setTracking("unavailable");
        return;
      }
      const inBackground = await startFastPassBackground(trip!).catch(() => false);
      if (!current) return;
      background.current = inBackground;
      setTracking(inBackground ? "background" : "foreground");
      if (!inBackground) {
        subscription = await watchFastPassLocation(point => void report(point));
        if (!current) subscription.remove();
      }
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await report(point);
    }
    setTracking("starting");
    void start().catch(() => { if (current) setTracking(background.current ? "background" : "unavailable"); });
    return () => { current = false; subscription?.remove(); };
  }, [activeTripId, account, queryClient]);

  const data = options.data;
  const vehicle = data?.vehicles.find(item => item.id === vehicleId);
  const identity: Identity = {
    firstName: data?.firstName ?? "", lastName: data?.lastName ?? "", company: data?.company ?? "",
    vehiclePlate: vehicle?.vehiclePlate ?? "", plateState: vehicle?.plateState ?? "", ...patch,
  };
  const validIdentity = FastPassIdentitySchema.safeParse(identity);
  const choosePanel = (name: typeof expanded) => setExpanded(current => current === name ? null : name);
  function selectVehicle(id: string) {
    setVehicleId(id);
    setExpanded(null);
    setPatch(current => {
      const { vehiclePlate, plateState, ...person } = current;
      return person;
    });
  }
  async function startTrip() {
    if (!vehicle || !destination || !data || !validIdentity.success || activeRequest.current) return;
    if (!normalizePlateState(validIdentity.data.plateState)) {
      setExpanded("details");
      setMessage("Enter a valid plate issuing state.");
      return;
    }
    const scope = captureAuthScope();
    activeRequest.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const consent = await getDeviceConsentStatus();
      if (!isAuthScopeCurrent(scope)) return;
      if (consent === "unavailable") throw new Error("Location sharing could not be verified.");
      if (consent !== "accepted") {
        router.push({ pathname: "/location-consent", params: { returnTo: "/fast-pass" } });
        return;
      }
      if ((await Location.requestForegroundPermissionsAsync()).status !== "granted") {
        setMessage("Allow location access in Settings to use Fast Pass.");
        return;
      }
      if (!isAuthScopeCurrent(scope)) return;
      requestId.current ??= nativeUuid();
      const next = await apiFetch<FastPassTrip>(tripsApi, {
        method: "POST",
        headers: { "x-vndrly-device-id": await getDeviceId() },
        body: JSON.stringify({ operationId: requestId.current, owner: data.owner, driverUserId: data.userId,
          vehicleAssetId: vehicle.id, siteLocationId: destination.siteId, destinationSource: "confirmed",
          fastPass: { identity: validIdentity.data, destinationId: destination.id } }),
      }, scope);
      requestId.current = null;
      if (isAuthScopeCurrent(scope)) queryClient.setQueryData(tripKey, next);
    } catch (error) {
      setMessage(errorMessage(error, "The trip couldn't start. Check your connection and try again."));
      void tripQuery.refetch();
    } finally { activeRequest.current = false; setBusy(false); }
  }
  async function leaveTrip() {
    if (!trip?.fastPass || activeRequest.current) return;
    const scope = captureAuthScope();
    activeRequest.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      if (trip.presenceState === "en_route") {
        await apiFetch(tripsApi + "/" + trip.id + "/complete", {
          method: "POST",
          body: JSON.stringify({ operationId: nativeUuid(), expectedVersion: trip.version,
            reason: "end_of_work", completedAt: new Date().toISOString() }),
        }, scope);
        await stopFastPassBackground();
        await history.refetch();
      } else {
        await apiFetch(fastPassApi + "/" + trip.id + "/checkout", { method: "POST" }, scope);
      }
    } catch (error) {
      setMessage(errorMessage(error, "Your trip changed. Review it and try again."));
    } finally {
      if (isAuthScopeCurrent(scope)) void tripQuery.refetch();
      activeRequest.current = false;
      setBusy(false);
    }
  }

  const pass = trip?.fastPass;
  const directions = route.data;
  const point = trip?.lastReliablePoint;
  const status = pass?.checkoutRequestedAt ? "Checkout requested"
    : trip?.presenceState === "on_site" ? "On site"
    : pass?.clearance ? "Cleared · " + pass.clearance.gateName : "En route";
  return (
    <GatePage title="Fast Pass">
      {tripQuery.isPending && <GateLoading />}
      {tripQuery.isError && <GateError message="Couldn't load your active trip." retry={() => void tripQuery.refetch()} />}
      {trip && !pass && <GateCard title="Active trip" icon="truck"><Text style={gateStyle.text}>Finish your current work trip before starting Fast Pass.</Text></GateCard>}
      {!trip && tripQuery.isSuccess && <GateCard title="Start a run" icon="truck">
        {options.isPending && <GateLoading />}
        {options.isError && <GateError message="Couldn't load your trucks and destinations." retry={() => void options.refetch()} />}
        {data && <>
          <GateRow label="Truck" detail={vehicle?.name ?? "Select your truck"} icon="truck" onPress={() => choosePanel("truck")} expanded={expanded === "truck"} />
          {expanded === "truck" && (data.vehicles.length ? data.vehicles.map(item => (
            <GateRow key={item.id} label={item.name} detail={[item.vehiclePlate, item.plateState].filter(Boolean).join(" · ")} onPress={() => selectVehicle(item.id)} />
          )) : <Text style={gateStyle.muted}>Your company has no saved trucks.</Text>)}
          <GateRow label="Destination" detail={destination?.title ?? "Select your destination"} icon="map-pin" onPress={() => choosePanel("destination")} expanded={expanded === "destination"} />
          {expanded === "destination" && (data.sites.length ? data.sites.map(site => <View key={site.id}>
            {[{ id: null, name: site.name }, ...site.destinations].map(place => {
              const title = place.id ? site.name + " · " + place.name : site.name;
              return <GateRow key={place.id ?? "site"} label={title} onPress={() => { setDestination({ siteId: site.id, id: place.id, title }); setExpanded(null); }} />;
            })}
          </View>) : <Text style={gateStyle.muted}>No destinations are available for your company.</Text>)}
          <GateRow label="Arrival details" icon="credit-card" expanded={expanded === "details"} onPress={() => choosePanel("details")}
            detail={validIdentity.success ? [identity.firstName + " " + identity.lastName, identity.company, identity.vehiclePlate + " " + identity.plateState].join(" · ") : "Review the five fields sent to the gate"} />
          {(expanded === "details" || !!vehicle && !validIdentity.success) && fields.map(field => <GateField key={field.key}
            label={field.label} value={identity[field.key] ?? ""}
            maxLength={field.key === "notes" ? 500 : undefined}
            autoCapitalize={field.key === "vehiclePlate" ? "characters" : "words"}
            onChangeText={value => setPatch(current => ({ ...current, [field.key]: value }))} />)}
          <GateRow label={busy ? "Starting…" : "En route"} icon="navigation" onPress={() => void startTrip()}
            disabled={!vehicle || !destination || !validIdentity.success || busy} />
        </>}
      </GateCard>}
      {trip && pass && <GateCard title={pass.destinationName} icon="navigation" subtitle={status}>
        <Text style={gateStyle.text}>{pass.identity.firstName} {pass.identity.lastName} · {pass.identity.company}</Text>
        <Text style={gateStyle.muted}>{pass.identity.vehiclePlate} · {pass.identity.plateState}</Text>
        {(directions || point) && <MapboxNativeMap height={250} controls styleKind="street"
          points={[
            ...(point ? [{ id: "driver", latitude: point.latitude, longitude: point.longitude, color: "#22d3ee", title: "Your position" }] : []),
            ...(directions ? [{ id: "destination", ...directions.destination, color: "#fbbf24", title: pass.destinationName }] : []),
          ]}
          lines={directions?.estimate?.coordinates ? [{
            id: "route", color: "#22d3ee", coordinates: directions.estimate.coordinates.map(([lon, lat]) => [lat, lon]),
          }] : []} />}
        {directions?.estimate && trip.presenceState === "en_route" && <Text style={gateStyle.text}>
          {directions.estimate.durationMinutes} min · {directions.estimate.distanceMiles.toFixed(1)} mi remaining
        </Text>}
        {tracking === "starting" && !point && <Text style={gateStyle.muted}>Getting your location…</Text>}
        {tracking === "foreground" && <Text style={gateStyle.muted}>Keep Fast Pass open to share progress.</Text>}
        {tracking === "unavailable" && <Text style={gateStyle.muted}>Location sharing is unavailable. Use the staffed gate.</Text>}
        {pass.checkoutRequestedAt && <Text style={gateStyle.muted}>Your checkout completes when the outer exit is recorded.</Text>}
        {trip.presenceState === "on_site" && !pass.checkoutRequestedAt && <GateRow
          label={busy ? "Requesting…" : "Check out"} icon="log-out" disabled={busy} onPress={() => void leaveTrip()} />}
        {trip.presenceState === "en_route" && <GateRow
          label={busy ? "Ending…" : "Cancel run"} icon="x" disabled={busy} onPress={() => void leaveTrip()} />}
      </GateCard>}
      <GateError message={message} />
      <GateCard title="Run history" icon="clock" expanded={showHistory} onHeaderPress={() => setShowHistory(current => !current)}>
        {showHistory && <>
          {history.isPending && <GateLoading />}
          {history.isError && <GateError message="Couldn't load your run history." retry={() => void history.refetch()} />}
          {history.isSuccess && !history.data.pages.some(page => page.trips.length) && <Text style={gateStyle.muted}>No runs yet.</Text>}
          {history.data?.pages.flatMap(page => page.trips.map(run => <View key={run.id} style={[gateStyle.row, { flexDirection: "column", alignItems: "flex-start", gap: 4 }]}>
            <Text style={gateStyle.text}>{run.site}{run.fastPass?.destinationName !== run.site ? " · " + run.fastPass?.destinationName : ""}</Text>
            {run.vehicle && <Text style={gateStyle.muted}>{run.vehicle}</Text>}
            <Text style={gateStyle.muted}>Departed for site · {readableTime(run.startedAt)}</Text>
            {run.checkInTime && <Text style={gateStyle.muted}>Checked in · {readableTime(run.checkInTime)}</Text>}
            {run.checkOutTime && <Text style={gateStyle.muted}>Checked out · {readableTime(run.checkOutTime)}</Text>}
            {!run.checkOutTime && run.completedAt && <Text style={gateStyle.muted}>Run ended · {readableTime(run.completedAt)}</Text>}
          </View>))}
          {history.hasNextPage && <GateRow label="Load earlier runs" onPress={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage} />}
        </>}
      </GateCard>
    </GatePage>
  );
}
