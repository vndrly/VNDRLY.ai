/** Native map apps choose the user's starting point; coordinates remain the destination. */
export function GateMapDirections({ latitude, longitude, es = false }: { latitude?: number | null; longitude?: number | null; es?: boolean }) {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return null;
  const destination = encodeURIComponent(`${latitude},${longitude}`);
  return <details className="gate-map-directions"><summary><Navigation aria-hidden="true" />{es ? "Cómo llegar" : "Get Directions"}</summary><div>
    <a href={`https://maps.apple.com/?daddr=${destination}&dirflg=d`} target="_blank" rel="noopener noreferrer">Apple Maps</a><span aria-hidden="true"> | </span>
    <a href={`https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`} target="_blank" rel="noopener noreferrer">Google Maps</a>
  </div></details>;
}
import { Navigation } from "lucide-react";

