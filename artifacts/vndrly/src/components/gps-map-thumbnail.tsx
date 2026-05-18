import { MapPin } from "lucide-react";
import { MAP_TILE_SIZE, getGoogleMapsUrl, getOsmTile } from "@/lib/maps";

type Props = {
  latitude: number;
  longitude: number;
  label?: string;
  size?: number;
};

export function GpsMapThumbnail({ latitude, longitude, label, size = 96 }: Props) {
  const tile = getOsmTile(latitude, longitude);
  const half = size / 2;
  return (
    <a
      href={getGoogleMapsUrl(latitude, longitude)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ? `View ${label} on map` : "View location on map"}
      className="relative block shrink-0 overflow-hidden rounded border-2 bg-muted"
      style={{ width: size, height: size, borderColor: "var(--brand-primary)" }}
    >
      <img
        src={tile.url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{
          position: "absolute",
          width: MAP_TILE_SIZE,
          height: MAP_TILE_SIZE,
          left: -tile.offsetX + half,
          top: -tile.offsetY + half,
          maxWidth: "none",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <MapPin
          className="h-5 w-5 drop-shadow"
          fill="currentColor"
          style={{ color: "var(--brand-primary)" }}
        />
      </div>
    </a>
  );
}
