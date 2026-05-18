import { Plus, ChevronRight, MapPin, Clock, LogOut, HardHat, Wrench } from "lucide-react";

const openTickets = [
  {
    id: 1287,
    site: "Permian Pad 14B",
    workType: "Wireline · Plug & Perf",
    partner: "Exxon Mobil",
    checkedInAt: "Today · 7:12 AM",
    elapsed: "3h 24m",
    color: "amber",
  },
  {
    id: 1281,
    site: "Eagle Ford SWD-7",
    workType: "Saltwater Disposal Haul",
    partner: "ConocoPhillips",
    checkedInAt: "Yesterday · 2:48 PM",
    elapsed: "1d 5h",
    color: "gray",
  },
];

export function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="h-1.5 bg-amber-500" />
      <header className="bg-white border-b border-gray-200 px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
          <HardHat className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">Precision Wellhead</p>
          <p className="text-sm font-bold text-gray-900 truncate">Tomás Morales</p>
        </div>
        <button className="w-9 h-9 rounded-md border border-gray-200 flex items-center justify-center text-gray-500">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <div className="px-5 pt-5 pb-3">
        <h2 className="text-lg font-bold text-gray-900">What are you doing?</h2>
        <p className="text-xs text-gray-500 mt-0.5">Pick up where you left off, or start a new ticket.</p>
      </div>

      <div className="px-5">
        <button className="w-full rounded-xl border-2 border-amber-500 bg-amber-500 hover:bg-amber-600 text-white p-4 flex items-center gap-3 shadow-md">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Plus className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-bold">New Ticket</p>
            <p className="text-[11px] text-white/85">Start a new visit at this site</p>
          </div>
          <ChevronRight className="w-5 h-5 text-white/85" />
        </button>
      </div>

      <div className="px-5 pt-6 pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Continue Existing</h3>
        <span className="text-[11px] text-gray-400">{openTickets.length} open</span>
      </div>

      <div className="px-5 space-y-3 pb-8">
        {openTickets.map(t => (
          <button
            key={t.id}
            className={`w-full text-left rounded-xl bg-white p-4 border ${t.color === "amber" ? "border-amber-300" : "border-gray-200"} shadow-sm hover:shadow-md transition-shadow`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${t.color === "amber" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                <Wrench className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-900 truncate">#{t.id}</p>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${t.color === "amber" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                    {t.color === "amber" ? "Active" : "Open"}
                  </span>
                </div>
                <p className="text-xs text-gray-700 mt-0.5 truncate">{t.workType}</p>
                <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-500">
                  <MapPin className="w-3 h-3" />
                  <span className="truncate">{t.site} · {t.partner}</span>
                </div>
                <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>Checked in {t.checkedInAt} · {t.elapsed}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
