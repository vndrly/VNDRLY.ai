import type { GateMapVehicle } from "@workspace/api-zod";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function gateMapVehiclePopup(vehicle: GateMapVehicle, spanish = false): string {
  const c = (en: string, es: string) => spanish ? es : en;
  const unavailable = c("Not available", "No disponible");
  const rows = [
    [c("Driver", "Conductor"), vehicle.driverName || unavailable],
    [c("Company", "Empresa"), vehicle.companyName],
    [c("Run / ticket", "Viaje / boleto"), `${vehicle.title} · #${vehicle.ticketNumber}`],
    [c("Speed", "Velocidad"), vehicle.speedMph == null ? unavailable : `${Math.round(vehicle.speedMph)} mph`],
    [c("Origin", "Origen"), vehicle.originName || unavailable],
    [c("Destination", "Destino"), vehicle.destinationName],
    ["ETA", vehicle.etaMinutes == null ? unavailable : `~${Math.ceil(vehicle.etaMinutes)} min`],
    [c("Heading", "Rumbo"), vehicle.headingDegrees == null ? unavailable : `${Math.round(vehicle.headingDegrees)}°`],
    [c("GPS accuracy", "Precisión GPS"), vehicle.accuracyMeters == null ? unavailable : `±${Math.round(vehicle.accuracyMeters)} m`],
    [c("Last update", "Última actualización"), vehicle.observedAt ? new Date(vehicle.observedAt).toLocaleString(spanish ? "es-US" : "en-US") : unavailable],
  ];
  return `<div class="gate-map-vehicle-details"><strong>${escape(vehicle.vehicleLabel || c("Tracked vehicle", "Vehículo rastreado"))}</strong><small>${escape(c("Driver app location", "Ubicación de la app del conductor"))}</small><dl>${rows.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl></div>`;
}
