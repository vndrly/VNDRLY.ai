import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { clusterPins, type ClusterPin } from "@workspace/map-utils";

function clusterIcon(count: number) {
  const size = count >= 10 ? 44 : 36;
  const html = `
    <div style="width:${size}px;height:${size}px;border-radius:50%;background:#1d4ed8;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:${count >= 10 ? 14 : 13}px;font-family:sans-serif;">
      ${count}
    </div>`;
  return L.divIcon({
    html,
    className: "vndrly-pin-cluster",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

type Props = {
  pins: ClusterPin[];
  enabled: boolean;
  clusterRadiusMeters?: number;
  renderPin: (pin: ClusterPin) => ReactNode;
  clusterPopup?: (members: ClusterPin[]) => ReactNode;
};

export function PinClusterMarkers({
  pins,
  enabled,
  clusterRadiusMeters = 400,
  renderPin,
  clusterPopup,
}: Props) {
  if (!enabled || pins.length <= 1) {
    return <>{pins.map((pin) => renderPin(pin))}</>;
  }

  const clusters = clusterPins(pins, clusterRadiusMeters);
  return (
    <>
      {clusters.map((cluster, idx) => {
        if (cluster.count === 1) {
          return renderPin(cluster.members[0]!);
        }
        const key = `cluster-${idx}-${cluster.latitude}-${cluster.longitude}`;
        return (
          <Marker
            key={key}
            position={[cluster.latitude, cluster.longitude]}
            icon={clusterIcon(cluster.count)}
          >
            {clusterPopup ? (
              <Popup>{clusterPopup(cluster.members)}</Popup>
            ) : (
              <Popup>
                <div className="text-sm font-medium">{cluster.count} crew nearby</div>
              </Popup>
            )}
          </Marker>
        );
      })}
    </>
  );
}
