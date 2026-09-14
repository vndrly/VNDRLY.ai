type ViewKind = "crew_map" | "gate_log" | "safety" | "coverage" | "meeting_room";

const labels: Record<ViewKind, string> = {
  crew_map: "Crew map", gate_log: "Gate log", safety: "Safety response",
  coverage: "Workforce coverage", meeting_room: "Meeting room",
};

export default function OperationsDisplayPage({
  displayName = "Operations display", monitorName = "Monitor", view = "crew_map", privacyMode = true,
}: { displayName?: string; monitorName?: string; view?: ViewKind; privacyMode?: boolean }) {
  return (
    <main className="min-h-screen w-screen overflow-hidden bg-slate-950 text-white" data-testid="operations-display" data-read-only="true">
      <header className="flex items-center justify-between border-b border-white/15 px-6 py-4">
        <div><p className="text-sm text-white/65">{displayName} · {monitorName}</p><h1 className="text-2xl font-semibold">{labels[view]}</h1></div>
        <div className="text-right text-xs text-white/60"><p>Read-only display</p>{privacyMode && <p>Privacy mode</p>}</div>
      </header>
      <section className="grid min-h-[calc(100vh-81px)] place-items-center p-6" aria-live="polite">
        <div className="text-center"><p className="text-lg">{labels[view]} is connected.</p>{view === "meeting_room" && <p className="mt-2 text-sm text-white/65">Camera off · Microphone off</p>}</div>
      </section>
    </main>
  );
}
