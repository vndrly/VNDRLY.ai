import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { captureGatePosition } from "@/lib/gate-location-capture";
import { useColors } from "@/hooks/useColors";
export type MapCamera = { center: [number, number]; zoom: number };
export const clampMapZoom = (zoom: number) => Math.max(0, Math.min(18, zoom));
export function mapWorld(
  latitude: number,
  longitude: number,
): [number, number] {
  const lat = Math.max(-85.051129, Math.min(85.051129, latitude));
  return [
    (longitude + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
  ];
}
export function mapCoordinate(x: number, y: number): [number, number] {
  return [
    (((x % 1) + 1) % 1) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, y))))) *
      180) /
      Math.PI,
  ];
}
export function panMapCamera(
  camera: MapCamera,
  dx: number,
  dy: number,
): MapCamera {
  const [x, y] = mapWorld(camera.center[1], camera.center[0]),
    scale = 512 * 2 ** camera.zoom;
  return { ...camera, center: mapCoordinate(x - dx / scale, y - dy / scale) };
}
export function useMapLocation(
  onLocation: (center: [number, number]) => void,
  viewKey?: string,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [location, setLocation] = useState<[number, number] | null>(null),
    controller = useRef<AbortController | null>(null),
    callback = useRef(onLocation);
  callback.current = onLocation;
  useEffect(() => {
    setLocation(null);
    setError("");
    setBusy(false);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [viewKey]);
  async function locate() {
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setBusy(false);
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      const position = await captureGatePosition(request.signal);
      if (controller.current !== request || request.signal.aborted) return;
      const point: [number, number] = [position.longitude, position.latitude];
      setLocation(point);
      callback.current(point);
    } catch (e) {
      if (controller.current === request && !request.signal.aborted)
        setError(
          `Location unavailable: ${(e as Error).message}. Pan the map manually.`,
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return { busy, error, location, locate };
}
export function MapControls({
  zoomIn,
  zoomOut,
  location,
}: {
  zoomIn: () => void;
  zoomOut: () => void;
  location: ReturnType<typeof useMapLocation>;
}) {
  const colors = useColors();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        gap: 6,
        maxWidth: 240,
      }}
    >
      {[
        { label: "Zoom in", text: "+", press: zoomIn },
        { label: "Zoom out", text: "−", press: zoomOut },
        {
          label: location.busy
            ? "Cancel current location"
            : "Center current location",
          text: location.busy ? "×" : "◎",
          press: () => void location.locate(),
        },
      ].map((button) => (
        <Pressable
          key={button.label}
          accessibilityRole="button"
          accessibilityLabel={button.label}
          onPress={button.press}
          style={{
            width: 44,
            height: 44,
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 8,
            backgroundColor: colors.card,
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "flex-end",
          }}
        >
          <Text style={{ color: colors.text, fontSize: 24 }}>
            {button.text}
          </Text>
        </Pressable>
      ))}
      {location.error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.text,
            backgroundColor: colors.card,
            padding: 8,
          }}
        >
          {location.error}
        </Text>
      ) : null}
    </View>
  );
}
