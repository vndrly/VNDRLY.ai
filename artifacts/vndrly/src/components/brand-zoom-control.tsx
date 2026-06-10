import { useEffect, useRef } from "react";
import { Plus, Minus } from "lucide-react";
import L from "leaflet";
import { useMap } from "react-leaflet";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function BrandZoomControl({ onZoomIn, onZoomOut }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);
  const halfStyle = {
    backgroundColor: "var(--brand-primary)",
  } as const;
  const halfClass =
    "w-6 h-6 inline-flex items-center justify-center text-white cursor-pointer select-none";
  return (
    <div
      ref={wrapperRef}
      className="inline-flex flex-col items-stretch rounded-full overflow-hidden"
      data-testid="map-zoom-control"
    >
      <button
        type="button"
        onClick={onZoomIn}
        className={halfClass}
        style={halfStyle}
        aria-label="Zoom in"
        data-testid="button-map-zoom-in"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <div className="h-px bg-gray-300" />
      <button
        type="button"
        onClick={onZoomOut}
        className={halfClass}
        style={halfStyle}
        aria-label="Zoom out"
        data-testid="button-map-zoom-out"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}

type InMapProps = {
  position?: "top-left" | "top-right";
};

export function BrandZoomControlInMap({ position = "top-left" }: InMapProps) {
  const map = useMap();
  const pos = position === "top-right" ? "top-2 right-2" : "top-2 left-2";
  return (
    <div className={`absolute ${pos} z-[500] pointer-events-auto`}>
      <BrandZoomControl
        onZoomIn={() => map.zoomIn()}
        onZoomOut={() => map.zoomOut()}
      />
    </div>
  );
}
