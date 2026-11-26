/** Pure rules for the native Gate Map: who is plotted, how fresh, and what the map remembers. */
export type LiveLocation = { latitude: number; longitude: number; accuracy?: number; capturedAt: string };
export type LiveStaff = {
  userId: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  assignment: string;
  locationReason: string;
  fresh: boolean;
  demonstration?: boolean;
  onWatch?: boolean;
  onCall?: boolean;
  location: LiveLocation | null;
  lastKnownLocation?: LiveLocation | null;
};
export type LiveGate = {
  id: string;
  name: string;
  siteId: number;
  siteName: string;
  latitude: number | null;
  longitude: number | null;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
};
export type LiveCoverage = {
  gates: LiveGate[];
  staff: LiveStaff[];
  duties: { id: string; userId: number; stationId: string }[];
  pins?: { id: string; label: string; latitude: number; longitude: number }[];
  vehicles?: { runId: string; latitude: number; longitude: number; vehicleLabel?: string | null }[];
};
export type LiveMapPoint = { id: string; latitude: number; longitude: number; color: string; label: string; title: string; fullLabel?: string };
export type PersonPosition = LiveLocation & { kind: "live" | "last" | "sample" };
export type SavedMapView = { camera?: { center: [number, number]; zoom: number }; styleKind: "satellite" | "street"; listOpen: boolean };

export const LIVE_COLOR = "#22a565", LAST_COLOR = "#d97706", SAMPLE_COLOR = "#8b5cf6", GATE_COLOR = "#0f766e", EMPTY_GATE_COLOR = "#6b7280";

/** A current report wins; otherwise the server's separately labeled last known position. */
export function personPosition(person: Pick<LiveStaff, "location" | "lastKnownLocation" | "fresh" | "demonstration">): PersonPosition | null {
  if (person.location && (person.fresh || person.demonstration)) return { ...person.location, kind: person.fresh ? "live" : "sample" };
  return person.lastKnownLocation ? { ...person.lastKnownLocation, kind: "last" } : null;
}

export function ageText(capturedAt: string, now: number, es = false): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(capturedAt)) / 60000));
  if (minutes < 1) return es ? "ahora" : "just now";
  const span = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return es ? `hace ${span}` : `${span} ago`;
}

/** One plain line: where this person's dot comes from, or why there is none. */
export function personStatus(person: LiveStaff, now: number, es = false): string {
  const position = personPosition(person);
  if (position?.kind === "live") return (es ? "En vivo · " : "Live · ") + ageText(position.capturedAt, now, es);
  if (position?.kind === "last") return (es ? "Última ubicación " : "Last seen ") + ageText(position.capturedAt, now, es);
  if (position) return es ? "Ubicación de ejemplo" : "Sample location";
  if (person.locationReason === "sharing_off") return es ? "Ubicación compartida desactivada" : "Location sharing is off";
  if (person.locationReason === "off_duty") return es ? "Fuera de servicio" : "Off duty";
  if (person.locationReason === "no_report") return es ? "Aún sin ubicación reportada" : "No location reported yet";
  return es ? "Ubicación no disponible" : "Location unavailable";
}

const initials = (name: string) => name.split(/\s+/).map(part => part[0] ?? "").slice(0, 2).join("").toUpperCase() || "?";
const plottable = (latitude: unknown, longitude: unknown) => typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

export function gatePosition(gate: LiveGate): { latitude: number; longitude: number } | null {
  const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
  return plottable(latitude, longitude) ? { latitude: latitude as number, longitude: longitude as number } : null;
}

/** Stable ids keep each pin the same native marker between refreshes. */
export function liveMapPoints(coverage: LiveCoverage, now: number, es = false): LiveMapPoint[] {
  const staffed = new Set(coverage.duties.map(duty => duty.stationId));
  return [
    ...coverage.gates.flatMap(gate => {
      const position = gatePosition(gate);
      return position ? [{ id: `gate:${gate.id}`, ...position, color: staffed.has(gate.id) ? GATE_COLOR : EMPTY_GATE_COLOR, label: "G", title: gate.name, fullLabel: gate.name }] : [];
    }),
    ...(coverage.pins ?? []).filter(pin => plottable(pin.latitude, pin.longitude)).map(pin => ({ id: `pin:${pin.id}`, latitude: pin.latitude, longitude: pin.longitude, color: "#7c3aed", label: "P", title: pin.label, fullLabel: pin.label })),
    ...(coverage.vehicles ?? []).filter(vehicle => plottable(vehicle.latitude, vehicle.longitude)).map(vehicle => ({ id: `vehicle:${vehicle.runId}`, latitude: vehicle.latitude, longitude: vehicle.longitude, color: "#f97316", label: "V", title: vehicle.vehicleLabel || (es ? "Vehículo" : "Vehicle") })),
    ...coverage.staff.flatMap(person => {
      const position = personPosition(person);
      if (!position || !plottable(position.latitude, position.longitude)) return [];
      const first = person.name.split(/\s+/)[0] || person.name;
      return [{ id: `staff:${person.userId}`, latitude: position.latitude, longitude: position.longitude,
        color: position.kind === "live" ? LIVE_COLOR : position.kind === "last" ? LAST_COLOR : SAMPLE_COLOR, label: initials(person.name), title: person.name,
        fullLabel: position.kind === "last" ? `${first} · ${ageText(position.capturedAt, now, es)}` : first }];
    }),
  ];
}

/** Same three rosters as the website map; people who can be seen come first. */
export function staffGroups(coverage: Pick<LiveCoverage, "staff" | "duties">, es = false) {
  const watching = (person: LiveStaff) => !!person.onWatch || coverage.duties.some(duty => duty.userId === person.userId);
  const rank = (person: LiveStaff) => ({ live: 0, sample: 1, last: 2, none: 3 })[personPosition(person)?.kind ?? "none"];
  const order = (people: LiveStaff[]) => people.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return [
    { id: "watch" as const, title: es ? "De guardia" : "On Watch", people: order(coverage.staff.filter(watching)) },
    { id: "call" as const, title: es ? "Disponible" : "On Call", people: order(coverage.staff.filter(person => !watching(person) && person.onCall)) },
    { id: "other" as const, title: es ? "Todos los demás" : "Everyone else", people: order(coverage.staff.filter(person => !watching(person) && !person.onCall)) },
  ];
}

export function mapSummary(staff: LiveStaff[], es = false): string {
  const kinds = staff.map(person => personPosition(person)?.kind);
  const live = kinds.filter(kind => kind === "live").length, last = kinds.filter(kind => kind === "last").length;
  if (!live && !last) return es ? "Nadie comparte ubicación ahora" : "No one is sharing a location right now";
  return [live ? (es ? `${live} en vivo` : `${live} live`) : "", last ? (es ? `${last} con última ubicación` : `${last} last seen`) : ""].filter(Boolean).join(" · ");
}

/** Tells the signed-in worker whether the company can see them, and why not. */
export function ownVisibility(staff: LiveStaff[], userId: number | undefined, now: number, es = false): { visible: boolean; text: string } | null {
  const me = staff.find(person => person.userId === userId);
  if (!me) return null;
  const position = personPosition(me);
  if (position?.kind === "live") return { visible: true, text: es ? "Su empresa puede verle en el mapa" : "Your company can see you on the map" };
  if (position?.kind === "last") return { visible: false, text: (es ? "Su último reporte fue " : "Your last report was ") + ageText(position.capturedAt, now, es) };
  if (me.locationReason === "sharing_off") return { visible: false, text: es ? "No comparte ubicación. Autorice este dispositivo en Perfil." : "You are not sharing location. Authorize this device in Profile." };
  if (me.locationReason === "off_duty") return { visible: false, text: es ? "Fuera de servicio: su ubicación no se comparte" : "Off duty: your location is not shared" };
  return { visible: false, text: es ? "En servicio, pero este dispositivo aún no ha reportado" : "On duty, but this device has not reported yet" };
}

/** Only a complete, in-range camera is restored; anything else starts fitted to the coverage. */
export function parseSavedMapView(raw: string | null | undefined): SavedMapView {
  const fallback: SavedMapView = { styleKind: "satellite", listOpen: false };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    const [longitude, latitude] = Array.isArray(value?.camera?.center) ? value.camera.center : [];
    const zoom = value?.camera?.zoom;
    return {
      ...(plottable(latitude, longitude) && typeof zoom === "number" && zoom >= 0 && zoom <= 22 ? { camera: { center: [longitude, latitude] as [number, number], zoom } } : {}),
      styleKind: value?.styleKind === "street" ? "street" : "satellite",
      listOpen: value?.listOpen === true,
    };
  } catch {
    return fallback;
  }
}

/** What AskV asked this screen to show, and whether it truly is on the map. */
export function askVMapView(params: { staffUserId?: string; reveal?: string }, coverage: LiveCoverage | undefined, failed: boolean): { target: string; state: "loading" | "displayed" | "unavailable" | "error" } | undefined {
  const staffId = Number(params.staffUserId) || null;
  const target = staffId ? `staff:${staffId}` : params.reveal === "staff" ? "staff" : "";
  if (!target) return undefined;
  if (failed) return { target, state: "error" };
  if (!coverage) return { target, state: "loading" };
  const shown = coverage.staff.some(person => (!staffId || person.userId === staffId) && personPosition(person));
  return { target, state: shown ? "displayed" : "unavailable" };
}
