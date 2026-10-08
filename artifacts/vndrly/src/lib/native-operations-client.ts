export type NativeOperationRequest = {
  id?: string; state: string; kind?: "location" | "photo"; workerUserId?: number;
  ticketId?: number | null; siteId?: number | null; purpose?: string;
  createdAt?: string; expiresAt?: string; allowLibrary?: boolean;
  result: Record<string, unknown> | null;
};

export async function nativeOperationsRequest<T = unknown>(
  path: string, init: RequestInit = {}, http: typeof fetch = fetch,
): Promise<T> {
  if (!/^\/[a-z0-9/-]*(?:\?[^#]*)?$/i.test(path)) throw Error("Invalid operation path");
  const response = await http(`/api/native-operations${path}`, {
    credentials: "include", ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null) as { message?: unknown; error?: unknown } | null;
    throw Error(typeof value?.message === "string" ? value.message : `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const states: Record<string, [string, string]> = {
  pending: ["Pending", "Pendiente"], delivered: ["Delivered — awaiting response", "Entregada — esperando respuesta"],
  opened: ["Opened — awaiting response", "Abierta — esperando respuesta"],
  awaiting_worker: ["Awaiting worker", "Esperando al trabajador"],
  upload_in_progress: ["Uploading — not saved yet", "Subiendo — aún sin guardar"],
  saved: ["Saved", "Guardada"], completed: ["Completed", "Completada"],
  declined: ["Declined", "Rechazada"], expired: ["Expired", "Vencida"],
  unavailable: ["Unavailable", "No disponible"], cancelled: ["Cancelled", "Cancelada"],
};
export function nativeRequestLabel(state: string, language: "en" | "es"): string {
  return states[state.replaceAll("-", "_")]?.[language === "es" ? 1 : 0] ?? state.replaceAll("_", " ").replaceAll("-", " ");
}

/** Server result, rather than transport status, supplies any evidence. */
export function nativeRequestEvidence(request: Pick<NativeOperationRequest, "state" | "result">, language: "en" | "es" = "en"): string[] {
  const r = request.result;
  if (!r) return [];
  const text: string[] = [];
  const location = (value: unknown, lastKnown: boolean) => {
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const lat = Number(row.latitude), lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || row.latitude === null || row.longitude === null) return;
    const label = lastKnown ? language === "es" ? "Última conocida" : "Last known" : language === "es" ? "Ubicación capturada" : "Captured location";
    text.push(`${label}: ${lat}, ${lng}`);
    if (typeof row.capturedAt === "string") text.push(`${language === "es" ? "Capturada" : "Captured"}: ${row.capturedAt}`);
    const accuracy = row.accuracy ?? row.accuracyM;
    if (typeof accuracy === "number") text.push(`${language === "es" ? "Precisión" : "Accuracy"}: ${accuracy} m`);
  };
  location(r.lastKnown, true);
  if (["saved", "completed"].includes(request.state)) location(r.location, false);
  if (typeof r.reason === "string") text.push(r.reason);
  if (r.late === true) text.push(language === "es" ? "Resultado tardío" : "Late result");
  if (["saved", "completed"].includes(request.state) && r.photo && typeof r.photo === "object") {
    const photo = r.photo as Record<string, unknown>;
    if (photo.attachmentId || photo.id) text.push(`${language === "es" ? "Adjunto guardado" : "Saved attachment"}: ${String(photo.attachmentId ?? photo.id)}`);
  }
  return text;
}
