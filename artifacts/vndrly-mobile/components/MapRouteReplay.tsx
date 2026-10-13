import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapboxNativeMap from "./MapboxNativeMap";
import TogglePillButton from "./TogglePillButton";
import { useColors } from "@/hooks/useColors";
import {
  analyzeRoute,
  routePositionAt,
  routeTimecode,
  type RouteReplayPoint,
  type RouteReplayEvent,
} from "@/lib/map-route-replay";

export type MapRouteReplayProps = {
  points: readonly RouteReplayPoint[];
  events?: readonly RouteReplayEvent[];
  title?: string;
  height?: number;
  truncated?: boolean;
  runStatus?: string;
};
export default function MapRouteReplay({
  points,
  events = [],
  title = "Recorded route replay",
  height = 360,
  truncated = false,
  runStatus,
}: MapRouteReplayProps) {
  const colors = useColors(),
    route = useMemo(() => analyzeRoute(points), [points]);
  const [offset, setOffset] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState<1 | 4 | 16>(1),
    [trackWidth, setTrackWidth] = useState(1);
  useEffect(() => {
    setOffset(0);
    setPlaying(false);
  }, [points]);
  useEffect(() => {
    if (!playing) return;
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(),
        elapsed = now - previous;
      previous = now;
      setOffset((current) =>
        Math.min(route.durationMs, current + elapsed * speed),
      );
    }, 250);
    return () => clearInterval(timer);
  }, [playing, speed, route.durationMs]);
  useEffect(() => {
    if (offset >= route.durationMs) setPlaying(false);
  }, [offset, route.durationMs]);
  const at = (route.startMs ?? 0) + offset,
    position = routePositionAt(route.points, at),
    percent = route.durationMs ? offset / route.durationMs : 0;
  const pins = position
    ? [
        {
          id: "replay-position",
          latitude: position.latitude,
          longitude: position.longitude,
          label: "R",
          title: position.interpolated
            ? "Estimated position between phone samples"
            : "Recorded phone sample",
          color: colors.primary,
        },
      ]
    : [];
  const lines = route.segments
    .filter((s) => s.length > 1)
    .map((segment, index) => ({
      id: `recorded-segment-${index}`,
      coordinates: segment.map(
        (p) => [p.latitude, p.longitude] as [number, number],
      ),
      color: colors.primary,
      width: 3,
    }));
  const orderedEvents = events
    .filter((e) => Number.isFinite(Date.parse(e.recordedAt)))
    .slice()
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const runStart=orderedEvents.find(event=>event.label==="start"), runFinish=["completed","cancelled"].includes(runStatus??"")?orderedEvents.at(-1):undefined;
  const seek = (milliseconds: number) => {
    setPlaying(false);
    setOffset(Math.max(0, Math.min(route.durationMs, milliseconds)));
  };
  const muted = { color: colors.mutedForeground, fontSize: 12 };
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 16,
        padding: 12,
        gap: 12,
        backgroundColor: colors.card,
      }}
    >
      <Text
        style={{ color: colors.foreground, fontWeight: "700", fontSize: 18 }}
      >
        {title}
      </Text>
      {runStart&&<Text style={{color:colors.foreground}}>Run started: {new Date(runStart.recordedAt).toLocaleString()} · {runFinish?"Total reported run time: "+routeTimecode(Date.parse(runFinish.recordedAt)-Date.parse(runStart.recordedAt)):"Run remains open"}</Text>}
      {truncated && (
        <Text style={muted}>
          Partial recording: the sample limit was reached. Estimates cover only
          the displayed history.
        </Text>
      )}
      {!route.points.length ? (
        <Text style={muted}>No recorded location samples.</Text>
      ) : (
        <>
          <MapboxNativeMap
            controls
            height={height}
            points={pins}
            lines={lines}
            viewKey={`replay:${route.startMs}:${route.endMs}`}
            selectedPointId="replay-position"
          />
          <Text accessibilityRole="timer" style={{ color: colors.foreground }}>
            {routeTimecode(offset)} / {routeTimecode(route.durationMs)} ·{" "}
            {new Date(at).toLocaleString()}
          </Text>
          <Text style={muted}>
            {position
              ? position.interpolated
                ? "Estimated position between recorded samples"
                : "Recorded phone location"
              : "Location unknown during this recording gap"}
          </Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Route replay timeline"
            accessibilityValue={{
              min: 0,
              max: Math.round(route.durationMs / 1000),
              now: Math.round(offset / 1000),
              text: routeTimecode(offset),
            }}
            accessibilityActions={[
              { name: "increment", label: "Forward 10 seconds" },
              { name: "decrement", label: "Back 10 seconds" },
            ]}
            onAccessibilityAction={(e) =>
              seek(
                offset +
                  (e.nativeEvent.actionName === "increment" ? 10000 : -10000),
              )
            }
            onLayout={(e) =>
              setTrackWidth(Math.max(1, e.nativeEvent.layout.width))
            }
            onPress={(e) =>
              seek((e.nativeEvent.locationX / trackWidth) * route.durationMs)
            }
            style={{ height: 34, justifyContent: "center" }}
          >
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.border,
              }}
            >
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  width: `${percent * 100}%`,
                  backgroundColor: colors.primary,
                }}
              />
            </View>
          </Pressable>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <TogglePillButton
              compactOnTablet
              disabled={!route.durationMs}
              onPress={() => {
                if (offset >= route.durationMs) setOffset(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : "Play"}
            </TogglePillButton>
            <TogglePillButton compactOnTablet onPress={() => seek(0)}>
              Restart
            </TogglePillButton>
            {([1, 4, 16] as const).map((value) => (
              <TogglePillButton
                compactOnTablet
                key={value}
                solid={speed === value}
                accessibilityState={{ selected: speed === value }}
                onPress={() => setSpeed(value)}
              >
                {value}x
              </TogglePillButton>
            ))}
          </View>
          <Text style={{ color: colors.foreground }}>
            Estimated sampled distance:{" "}
            {(route.distanceMeters / 1609.344).toFixed(2)} mi · Recorded span:{" "}
            {routeTimecode(route.durationMs)}
          </Text>
          <Text style={muted}>
            Estimated sampled average / peak speed:{" "}
            {route.averageSampledSpeedMps === null
              ? "Unavailable"
              : `${(route.averageSampledSpeedMps * 2.236936).toFixed(1)} / ${(route.maxSampledSpeedMps! * 2.236936).toFixed(1)} mph`}{" "}
            · {route.gapCount} recording gaps
          </Text>
          <Text style={muted}>
            Driver-phone samples; distance and speed are estimates. Gaps over
            120 seconds have no connecting route or estimated position. This is
            not verified vehicle telemetry.
          </Text>
          {!!orderedEvents.length && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                Recorded events
              </Text>
              {orderedEvents.map((event) => (
                <TogglePillButton
                  compactOnTablet
                  key={event.id}
                  disabled={
                    Date.parse(event.recordedAt) < (route.startMs ?? 0) ||
                    Date.parse(event.recordedAt) > (route.endMs ?? 0)
                  }
                  onPress={() =>
                    seek(Date.parse(event.recordedAt) - (route.startMs ?? 0))
                  }
                >
                  {new Date(event.recordedAt).toLocaleTimeString()} ·{" "}
                  {event.label}
                </TogglePillButton>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
