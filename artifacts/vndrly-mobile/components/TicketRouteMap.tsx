import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";

export type RoutePoint = {
  id?: number | string;
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

type LatLngTime = {
  latitude: number;
  longitude: number;
  time?: string | Date | null;
};

type Props = {
  site?: { latitude: number; longitude: number; name?: string | null } | null;
  checkIn?: LatLngTime | null;
  checkOut?: LatLngTime | null;
  tracking?: RoutePoint[];
  height?: number;
  selectedTrackingId?: number | string | null;
  onSelectTracking?: (id: number | string | null) => void;
};

function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

type MapLabels = {
  tracking: string;
  siteFallback: string;
  checkIn: string;
  checkOut: string;
};

function buildHtml(payload: string, labels: MapLabels, brandColor: string): string {
  const labelsLiteral = JSON.stringify(labels);
  const brand = JSON.stringify(brandColor);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #f3f4f6; }
  .pin {
    width: 28px; height: 36px; position: relative;
  }
  .pin .head {
    position: absolute; left: 0; top: 0;
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    color: #fff; font-weight: 700; font-size: 11px; font-family: -apple-system, system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  .pin .tail {
    position: absolute; left: 11px; top: 26px;
    width: 0; height: 0;
    border-left: 3px solid transparent;
    border-right: 3px solid transparent;
    border-top: 8px solid currentColor;
  }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #2563eb; border: 2px solid #fff;
    box-shadow: 0 0 2px rgba(0,0,0,0.5);
  }
  .dot-selected {
    width: 18px; height: 18px; border-radius: 50%;
    background: ${brandColor}; border: 3px solid #fff;
    box-shadow: 0 0 0 2px ${brandColor}, 0 0 6px rgba(0,0,0,0.6);
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function esc(v) {
    if (v == null) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function postRN(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  }
  var data = ${payload};
  var labels = ${labelsLiteral};
  var map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  function pinIcon(color, label) {
    return L.divIcon({
      className: 'vndrly-pin',
      html: '<div class="pin" style="color:' + color + '">' +
              '<div class="head" style="background:' + color + '">' + label + '</div>' +
              '<div class="tail"></div>' +
            '</div>',
      iconSize: [28, 36],
      iconAnchor: [14, 32],
      popupAnchor: [0, -30]
    });
  }
  var dotIcon = L.divIcon({
    className: 'vndrly-dot',
    html: '<div class="dot"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
  var dotIconSelected = L.divIcon({
    className: 'vndrly-dot-selected',
    html: '<div class="dot-selected"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  var allPoints = [];
  var trackingMarkers = {};

  if (data.path && data.path.length >= 2) {
    L.polyline(data.path, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(map);
  }
  (data.tracking || []).forEach(function (p, i) {
    var marker = L.marker([p.latitude, p.longitude], { icon: dotIcon })
      .bindPopup('<b>' + esc(labels.tracking.replace('{{n}}', String(i + 1))) + '</b><br/>' +
        (p.recordedAt ? esc(new Date(p.recordedAt).toLocaleString()) + '<br/>' : '') +
        p.latitude.toFixed(5) + ', ' + p.longitude.toFixed(5))
      .addTo(map);
    if (p.id != null) {
      trackingMarkers[String(p.id)] = marker;
      marker.on('click', function () {
        postRN({ type: 'selectTracking', id: p.id });
      });
    }
    allPoints.push([p.latitude, p.longitude]);
  });
  if (data.site) {
    L.marker([data.site.latitude, data.site.longitude], { icon: pinIcon(${brand}, 'S') })
      .bindPopup('<b>' + esc(data.site.name || labels.siteFallback) + '</b><br/>' +
        data.site.latitude.toFixed(5) + ', ' + data.site.longitude.toFixed(5))
      .addTo(map);
    allPoints.push([data.site.latitude, data.site.longitude]);
  }
  if (data.checkIn) {
    L.marker([data.checkIn.latitude, data.checkIn.longitude], { icon: pinIcon('#16a34a', 'In') })
      .bindPopup('<b>' + esc(labels.checkIn) + '</b><br/>' +
        (data.checkIn.time ? new Date(data.checkIn.time).toLocaleString() + '<br/>' : '') +
        data.checkIn.latitude.toFixed(5) + ', ' + data.checkIn.longitude.toFixed(5))
      .addTo(map);
    allPoints.push([data.checkIn.latitude, data.checkIn.longitude]);
  }
  if (data.checkOut) {
    L.marker([data.checkOut.latitude, data.checkOut.longitude], { icon: pinIcon('#dc2626', 'Out') })
      .bindPopup('<b>' + esc(labels.checkOut) + '</b><br/>' +
        (data.checkOut.time ? new Date(data.checkOut.time).toLocaleString() + '<br/>' : '') +
        data.checkOut.latitude.toFixed(5) + ', ' + data.checkOut.longitude.toFixed(5))
      .addTo(map);
    allPoints.push([data.checkOut.latitude, data.checkOut.longitude]);
  }

  if (allPoints.length === 1) {
    map.setView(allPoints[0], 16);
  } else if (allPoints.length > 1) {
    map.fitBounds(allPoints, { padding: [32, 32], maxZoom: 17 });
  } else {
    map.setView([0, 0], 2);
  }

  var currentSelected = null;
  window.__selectTracking = function (id) {
    if (currentSelected != null && trackingMarkers[String(currentSelected)]) {
      trackingMarkers[String(currentSelected)].setIcon(dotIcon);
      trackingMarkers[String(currentSelected)].setZIndexOffset(0);
    }
    currentSelected = id;
    if (id == null) return;
    var m = trackingMarkers[String(id)];
    if (!m) return;
    m.setIcon(dotIconSelected);
    m.setZIndexOffset(1000);
    var ll = m.getLatLng();
    map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 16), { animate: true });
  };

  if (data.selectedTrackingId != null) {
    window.__selectTracking(data.selectedTrackingId);
  }
</script>
</body>
</html>`;
}

export function TicketRouteMap({
  site,
  checkIn,
  checkOut,
  tracking,
  height = 280,
  selectedTrackingId,
  onSelectTracking,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const webViewRef = useRef<WebView>(null);

  const validSite =
    site && isValidLatLng(site.latitude, site.longitude) ? site : null;
  const validCheckIn =
    checkIn && isValidLatLng(checkIn.latitude, checkIn.longitude) ? checkIn : null;
  const validCheckOut =
    checkOut && isValidLatLng(checkOut.latitude, checkOut.longitude) ? checkOut : null;

  const sortedTracking = useMemo(() => {
    if (!tracking || tracking.length === 0) return [];
    return tracking
      .filter((p) => isValidLatLng(p.latitude, p.longitude))
      .slice()
      .sort((a, b) => {
        const at = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
        const bt = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
        return at - bt;
      });
  }, [tracking]);

  const path = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (validCheckIn) pts.push([validCheckIn.latitude, validCheckIn.longitude]);
    for (const p of sortedTracking) pts.push([p.latitude, p.longitude]);
    if (validCheckOut) pts.push([validCheckOut.latitude, validCheckOut.longitude]);
    return pts;
  }, [validCheckIn, validCheckOut, sortedTracking]);

  const hasAnything =
    validSite || validCheckIn || validCheckOut || sortedTracking.length > 0;

  const html = useMemo(() => {
    const payload = JSON.stringify({
      site: validSite
        ? {
            latitude: validSite.latitude,
            longitude: validSite.longitude,
            name: validSite.name ?? null,
          }
        : null,
      checkIn: validCheckIn
        ? {
            latitude: validCheckIn.latitude,
            longitude: validCheckIn.longitude,
            time:
              validCheckIn.time instanceof Date
                ? validCheckIn.time.toISOString()
                : validCheckIn.time ?? null,
          }
        : null,
      checkOut: validCheckOut
        ? {
            latitude: validCheckOut.latitude,
            longitude: validCheckOut.longitude,
            time:
              validCheckOut.time instanceof Date
                ? validCheckOut.time.toISOString()
                : validCheckOut.time ?? null,
          }
        : null,
      tracking: sortedTracking.map((p) => ({
        id: p.id ?? null,
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt:
          p.recordedAt instanceof Date
            ? p.recordedAt.toISOString()
            : p.recordedAt ?? null,
      })),
      path,
      selectedTrackingId: selectedTrackingId ?? null,
    });
    return buildHtml(payload, {
      tracking: t("routeMap.popupTracking", { n: "{{n}}" }),
      siteFallback: t("routeMap.siteFallback"),
      checkIn: t("routeMap.popupCheckIn"),
      checkOut: t("routeMap.popupCheckOut"),
    }, colors.primary);
    // selectedTrackingId is intentionally not in deps; updates handled via injectJavaScript
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSite, validCheckIn, validCheckOut, sortedTracking, path, t]);

  const selectionScript = useMemo(() => {
    const idLiteral =
      selectedTrackingId == null
        ? "null"
        : typeof selectedTrackingId === "number"
          ? String(selectedTrackingId)
          : JSON.stringify(String(selectedTrackingId));
    return `try { window.__selectTracking && window.__selectTracking(${idLiteral}); } catch (e) {} true;`;
  }, [selectedTrackingId]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(selectionScript);
  }, [selectionScript]);

  if (!hasAnything) {
    return (
      <View
        style={[
          styles.empty,
          { height, borderColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          {t("routeMap.noGps")}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrapper,
        { height, borderColor: colors.primary, backgroundColor: colors.muted },
      ]}
    >
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        nestedScrollEnabled
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        onLoadEnd={() => {
          webViewRef.current?.injectJavaScript(selectionScript);
        }}
        onMessage={(event) => {
          if (!onSelectTracking) return;
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg && msg.type === "selectTracking") {
              onSelectTracking(msg.id ?? null);
            }
          } catch {
            // ignore
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 2,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  empty: {
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
});
