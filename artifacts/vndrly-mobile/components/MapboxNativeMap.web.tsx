import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View, Pressable, PanResponder } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { readMapboxAccessToken, type MapboxMapStyle } from "@/lib/maps";
import { useColors } from "@/hooks/useColors";
import type {
  NativeMapPoint,
  NativeMapLine,
  NativeMapCircle,
} from "./MapboxNativeMap";
import {
  MapControls,
  clampMapZoom,
  mapWorld,
  mapCoordinate,
  panMapCamera,
  useMapLocation,
  type MapCamera,
} from "./MapCameraControls";
export default function MapboxWebPreview({
  points = [],
  lines = [],
  height = 340,
  styleKind = "satellite",
  onPointPress,
  center,
  zoom,
  selectedPointId,
  controls = false,
  viewKey,
}: {
  points?: NativeMapPoint[];
  lines?: NativeMapLine[];
  circles?: NativeMapCircle[];
  height?: any;
  center?: [number, number];
  zoom?: number;
  styleKind?: MapboxMapStyle;
  selectedPointId?: string | null;
  onPointPress?: (id: string) => void;
  controls?: boolean;
  viewKey?: string;
}) {
  const colors = useColors(),
    token = readMapboxAccessToken(),
    [width, setWidth] = useState(900),
    [override, setOverride] = useState<MapCamera | null>(null),
    [drag, setDrag] = useState({ x: 0, y: 0 });
  const valid = points.filter(
    (p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.latitude) <= 85 &&
      Math.abs(p.longitude) <= 180,
  );
  const h = typeof height === "number" ? height : 500,
    w = Math.max(100, width - 4),
    mapHeight = h - 4,
    extent = [...valid,...lines.flatMap(line=>line.coordinates.filter(([lat,lng])=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=85&&Math.abs(lng)<=180).map(([latitude,longitude])=>({latitude,longitude})))],
    xy = extent.map((p) => mapWorld(p.latitude, p.longitude)),
    xs = xy.map((p) => p[0]),
    ys = xy.map((p) => p[1]);
  const fallback = center ?? (!extent.length ? [-98.35, 39.5] : undefined),
    cx = fallback
      ? mapWorld(fallback[1], fallback[0])[0]
      : (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = fallback
      ? mapWorld(fallback[1], fallback[0])[1]
      : (Math.min(...ys) + Math.max(...ys)) / 2;
  const fitted =
    extent.length > 1
      ? Math.min(
          Math.log2(
            Math.max(1, w - 100) /
              (512 * Math.max(0.000001, Math.max(...xs) - Math.min(...xs))),
          ),
          Math.log2(
            Math.max(1, mapHeight - 100) /
              (512 * Math.max(0.000001, Math.max(...ys) - Math.min(...ys))),
          ),
        )
      : 15;
  const base: MapCamera = {
    center: mapCoordinate(cx, cy),
    zoom: clampMapZoom(
      fallback ? (valid.length ? (zoom ?? 15) : (zoom ?? 3)) : fitted,
    ),
  };
  const resetKey = `${viewKey}:${center?.[0]}:${center?.[1]}`;
  useEffect(() => {
    setOverride(controls ? base : null);
    setDrag({ x: 0, y: 0 });
  }, [resetKey, controls]);
  const effective = override ?? base,
    camera = useRef(effective);
  camera.current = effective;
  const location = useMapLocation(
    (point) =>
      setOverride({ center: point, zoom: Math.max(camera.current.zoom, 14) }),
    resetKey,
  );
  const displayedPoints = location.location
    ? [
        ...valid,
        {
          id: "device-location",
          longitude: location.location[0],
          latitude: location.location[1],
          label: "Me",
          title: "Current device location",
          color: "#2563eb",
        },
      ]
    : valid;
  const dragOrigin = useRef(effective);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          controls && (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5),
        onPanResponderGrant: () => {
          dragOrigin.current = camera.current;
        },
        onPanResponderMove: (_, g) => setDrag({ x: g.dx, y: g.dy }),
        onPanResponderRelease: (_, g) => {
          setOverride(panMapCamera(dragOrigin.current, g.dx, g.dy));
          setDrag({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => setDrag({ x: 0, y: 0 }),
      }),
    [controls],
  );
  const [x, y] = mapWorld(effective.center[1], effective.center[0]),
    scale = 512 * 2 ** effective.zoom,
    ratio = Math.min(1, 1280 / w, 1280 / mapHeight),
    iw = Math.round(w * ratio),
    ih = Math.round(mapHeight * ratio),
    imageZoom = effective.zoom + Math.log2(ratio);
  const url =
    "https://api.mapbox.com/styles/v1/mapbox/" +
    (styleKind === "street" ? "streets-v12" : "satellite-streets-v12") +
    "/static/" +
    effective.center[0] +
    "," +
    effective.center[1] +
    "," +
    imageZoom +
    "/" +
    iw +
    "x" +
    ih +
    "?attribution=false&logo=false&access_token=" +
    encodeURIComponent(token ?? "");
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        height: h,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: colors.card,
      }}
    >
      {!token ? (
        <Text style={{ padding: 16, color: colors.mutedForeground }}>
          Mapbox is not configured.
        </Text>
      ) : (
        <>
          <View
            {...responder.panHandlers}
            style={
              {
                height: mapHeight,
                width: "100%",
                overflow: "hidden",
                touchAction: controls ? "none" : "auto",
              } as any
            }
          >
            <View
              style={{
                height: mapHeight,
                width: "100%",
                transform: [{ translateX: drag.x }, { translateY: drag.y }],
              }}
            >
              <Image
                accessibilityLabel="Coverage map"
                source={{ uri: url }}
                style={{ height: mapHeight, width: "100%" }}
                resizeMode="stretch"
              />
              <Svg width={w} height={mapHeight} style={{position:"absolute",left:0,top:0}} pointerEvents="none">
                {lines.map(line=><Polyline key={line.id} points={line.coordinates.filter(([lat,lng])=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=85&&Math.abs(lng)<=180).map(([lat,lng])=>{const p=mapWorld(lat,lng);return `${w/2+(p[0]-x)*scale},${mapHeight/2+(p[1]-y)*scale}`;}).join(" ")} fill="none" stroke={line.color??colors.primary} strokeWidth={line.width??4} />)}
              </Svg>
              {displayedPoints.map((point) => {
                const projected = mapWorld(point.latitude, point.longitude),
                  left = w / 2 + (projected[0] - x) * scale,
                  top = mapHeight / 2 + (projected[1] - y) * scale;
                return (
                  <Pressable
                    key={point.id}
                    accessibilityRole="button"
                    accessibilityLabel={point.title ?? point.id}
                    accessibilityState={{
                      selected: selectedPointId === point.id,
                    }}
                    onPress={() => onPointPress?.(point.id)}
                    style={{
                      position: "absolute",
                      left: left - 19,
                      top: top - 19,
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: point.color ?? colors.primary,
                      borderWidth: selectedPointId === point.id ? 3 : 2,
                      borderColor: "#ffffff",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#ffffff",
                        fontWeight: "700",
                        fontSize: 12,
                      }}
                    >
                      {point.label ?? "G"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text
            style={{
              position: "absolute",
              bottom: 2,
              left: 3,
              fontSize: 10,
              color: "#111",
              backgroundColor: "#ffffffdd",
            }}
          >
            © Mapbox © OpenStreetMap
          </Text>
          {controls ? (
            <MapControls
              zoomIn={() =>
                setOverride({
                  ...camera.current,
                  zoom: clampMapZoom(camera.current.zoom + 1),
                })
              }
              zoomOut={() =>
                setOverride({
                  ...camera.current,
                  zoom: clampMapZoom(camera.current.zoom - 1),
                })
              }
              location={location}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
