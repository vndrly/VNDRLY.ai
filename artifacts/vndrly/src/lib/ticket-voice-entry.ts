/** Canonical ticket entry requests shared by the voice-opened web forms. */
export type TicketEntryKind = "photo" | "parts" | "labor" | "mileage";
export type EntryTicket = {
  id: number;
  status: string;
  lifecycleState?: string | null;
  startingMileage?: string | null;
};
export type MileageAction = "en-route" | "check-out";
export type EntryCoordinates = { latitude: number; longitude: number };
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MUTABLE_STATUSES = new Set(["initiated", "draft", "in_progress", "pending_review", "kicked_back"]);

export function parseTicketEntry(value: string | null): TicketEntryKind | null {
  return value === "photo" || value === "parts" || value === "labor" || value === "mileage" ? value : null;
}

export function canEnterTicket(ticket: EntryTicket, role?: string): boolean {
  return (role === "field_employee" || role === "vendor") && MUTABLE_STATUSES.has(ticket.status);
}

export function mileageActionFor(ticket: EntryTicket): MileageAction | null {
  if (["initiated", "draft", "in_progress"].includes(ticket.status)
    && [null, undefined, "pending_arrival", "en_route"].includes(ticket.lifecycleState)) return "en-route";
  return ticket.status === "in_progress" ? "check-out" : null;
}

export function mileageValue(input: string, action: MileageAction, startingMileage?: string | null): number | null {
  // Match the existing numeric(10,1) odometer storage without silently rounding user input.
  if (!/^\d{1,9}(?:\.\d)?$/.test(input.trim())) return null;
  const reading = Number(input);
  const starting = startingMileage == null ? null : Number(startingMileage);
  if (action === "check-out" && starting != null && Number.isFinite(starting) && reading < starting) return null;
  return reading;
}

export function getEntryCoordinates(signal: AbortSignal): Promise<EntryCoordinates> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) return abort();
    if (!navigator.geolocation) return reject(new Error("GPS unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) return abort();
      if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return reject(new Error("GPS unavailable"));
      resolve({ latitude: coords.latitude, longitude: coords.longitude });
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const response = await fetch(`${API_BASE}/api${path}`, {
    method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) throw Object.assign(new Error("Ticket entry could not be saved"), { status: response.status, data });
  return data as T;
}

export function isTicketPhoto(file: File): boolean {
  return file.type.startsWith("image/") && file.size > 0 && file.size <= 25 * 1024 * 1024;
}

/** Keep the same private upload/finalize flow as the field app; never use public employee-photo uploads. */
export async function uploadTicketPhoto(file: File, signal: AbortSignal): Promise<string> {
  if (!isTicketPhoto(file)) throw new Error("Invalid ticket photo");
  const signed = await post<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
    name: file.name, size: file.size, contentType: file.type,
  }, signal);
  if (!signed?.uploadURL || !signed.objectPath) throw new Error("Invalid upload response");
  const upload = await fetch(signed.uploadURL, { method: "PUT", signal, headers: { "Content-Type": file.type }, body: file });
  signal.throwIfAborted();
  if (!upload.ok) throw Object.assign(new Error("Photo upload failed"), { status: upload.status });
  await post("/storage/uploads/finalize", { objectURL: signed.uploadURL, visibility: "private" }, signal);
  return signed.objectPath;
}

export async function attachTicketPhoto(ticketId: number, objectPath: string, signal: AbortSignal): Promise<void> {
  await post(`/tickets/${ticketId}/note-logs`, { content: `[photo] ${objectPath}` }, signal);
}

export async function saveTicketMileage(ticketId: number, action: MileageAction, reading: number, coordinates: EntryCoordinates, signal: AbortSignal): Promise<void> {
  await post(`/tickets/${ticketId}/${action}`, {
    ...coordinates,
    ...(action === "en-route" ? { startingMileage: reading } : { endingMileage: reading, workCompleted: false }),
  }, signal);
}
