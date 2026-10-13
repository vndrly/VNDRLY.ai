import { useState } from "react";
import { PngPillButton } from "@/components/png-pill-rollover";
import { BrandedInput } from "@/components/work-hub/chrome";

export function TicketFieldActions({ id, status, lifecycleState, onSaved }: {
  id: number; status: string; lifecycleState?: string | null; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [mileage, setMileage] = useState("");
  const action = lifecycleState === "on_location" ? "check-in" : lifecycleState === "en_route" ? "on-location" : "en-route";
  if (!["initiated", "draft", "in_progress"].includes(status) || lifecycleState === "on_site" || lifecycleState === "off_site") return null;
  const run = async () => {
    const startingMileage = mileage.trim() ? Number(mileage) : null;
    if (startingMileage !== null && (!Number.isFinite(startingMileage) || startingMileage < 0)) { setError("Enter valid optional starting mileage."); return; }
    if (!window.confirm(action === "check-in" ? "Check in and start work using your current device location?" : action === "on-location" ? "Record arrival using your current device location? This does not start paid work." : "Start travel using your current device location?")) return;
    setBusy(true); setError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
      const response = await fetch(`/api/tickets/${id}/${action}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, ...(action === "en-route" && startingMileage !== null ? { startingMileage } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Work action failed");
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Work action failed. Refresh the ticket before retrying."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Field work actions" className="space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] p-4">
    <h2 className="font-semibold">Field work</h2>
    <p className="text-sm">Travel → Arrival → Check In → Check Out → Review. Arrival records your presence; Check In starts work.</p>
    {action === "en-route" && <label className="block text-sm">Starting mileage (optional)<BrandedInput inputMode="decimal" value={mileage} onChange={event => setMileage(event.target.value)} /></label>}
    <PngPillButton color="blue" disabled={busy} onClick={() => void run()}>{busy ? "Saving…" : action === "en-route" ? "Start Travel" : action === "on-location" ? "Record Arrival" : "Check In"}</PngPillButton>
    {error && <p role="alert">{error}</p>}
  </section>;
}
