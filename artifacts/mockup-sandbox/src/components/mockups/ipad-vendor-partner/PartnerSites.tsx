import {
  LayoutDashboard,
  MapPin,
  ClipboardList,
  Map as MapIcon,
  FileText,
  BarChart3,
  Settings,
  Bell,
  Search,
  Filter,
  QrCode,
  Plus,
  Camera,
  Edit3,
  CheckCircle2,
} from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: MapPin, label: "Site Locations", active: true, badge: 131 },
  { icon: ClipboardList, label: "Tickets" },
  { icon: MapIcon, label: "Site Map" },
  { icon: FileText, label: "1099 Reports" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Settings, label: "Settings" },
];

const SITES = [
  { code: "SITE-A41", name: "Reagan Co. — Pad 41", county: "Reagan, TX", vendor: "Permian Field Svc.", status: "Active", tickets: 8, tone: "emerald" },
  { code: "SITE-B12", name: "Howard Co. — Pad 17", county: "Howard, TX", vendor: "Permian Field Svc.", status: "Active", tickets: 5, tone: "emerald" },
  { code: "SITE-C03", name: "Blaine STACK 03", county: "Blaine, OK", vendor: "Mid-Con Wireline", status: "Active", tickets: 3, tone: "emerald" },
  { code: "SITE-A28", name: "Midland — Andrews 8", county: "Midland, TX", vendor: "Permian Field Svc.", status: "Paused", tickets: 0, tone: "amber" },
  { code: "SITE-D02", name: "Andrews Pad 02", county: "Andrews, TX", vendor: "RedDirt Services", status: "Active", tickets: 2, tone: "emerald" },
  { code: "SITE-E07", name: "Crane Co. — Pad 7", county: "Crane, TX", vendor: "Permian Field Svc.", status: "Active", tickets: 1, tone: "emerald" },
  { code: "SITE-F11", name: "Loving — Salt Flat 11", county: "Loving, TX", vendor: "—", status: "Inactive", tickets: 0, tone: "gray" },
  { code: "SITE-G05", name: "Eddy NM — South Pad", county: "Eddy, NM", vendor: "Mid-Con Wireline", status: "Active", tickets: 4, tone: "emerald" },
];

const TONE: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  gray: "bg-gray-500/15 text-gray-300 border-gray-500/40",
};

function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 bg-[#252a30] border-r border-white/10 flex flex-col">
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white font-bold">B</div>
        <div className="leading-tight">
          <div className="text-white text-sm font-semibold">Baker Hughes</div>
          <div className="text-gray-400 text-[11px]">Partner Portal</div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((n) => (
          <button key={n.label} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${n.active ? "bg-sky-500/15 text-white border border-sky-500/30" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}>
            <n.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{n.label}</span>
            {n.badge && <span className="text-[10px] bg-sky-500 text-white font-bold px-1.5 py-0.5 rounded-full">{n.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold">SM</div>
        <div className="leading-tight">
          <div className="text-white text-xs font-medium">Sarah Miller</div>
          <div className="text-gray-400 text-[10px]">Permian Ops Mgr</div>
        </div>
      </div>
    </aside>
  );
}

function FakeMap() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-md">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, #44494f 0%, #2c3035 70%)" }} />
      <svg className="absolute inset-0 w-full h-full opacity-20">
        {Array.from({ length: 8 }).map((_, i) => (
          <circle key={i} cx="50%" cy="50%" r={30 + i * 25} stroke="#fff" strokeWidth="0.5" fill="none" />
        ))}
      </svg>
      <svg className="absolute inset-0 w-full h-full">
        <circle cx="50%" cy="50%" r="60" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" strokeWidth="1.5" />
        <circle cx="50%" cy="50%" r="6" fill="#38bdf8" />
      </svg>
      <div className="absolute top-2 right-2 bg-black/60 text-[10px] text-gray-300 px-2 py-1 rounded border border-white/10">
        Geofence: 500 m
      </div>
    </div>
  );
}

export function PartnerSites() {
  const selected = SITES[0];
  return (
    <div className="w-full h-screen bg-[#3a3d42] flex overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-[#34373c] border-b border-white/10 px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-lg font-semibold">Site Locations</h1>
            <span className="text-[10px] text-gray-400">131 total · 124 active</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input placeholder="Search by code, county, vendor…" className="bg-[#2a2d31] text-gray-200 text-sm rounded-md pl-8 pr-3 py-1.5 w-72 border border-white/10 focus:outline-none focus:border-sky-500/50 placeholder:text-gray-500" />
            </div>
            <button className="text-gray-300 hover:text-white text-sm flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10">
              <Filter className="w-3.5 h-3.5" />Filters
            </button>
            <button className="text-white text-sm flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-600 font-medium">
              <Plus className="w-3.5 h-3.5" />Add site
            </button>
            <Bell className="w-5 h-5 text-gray-300" />
          </div>
        </header>

        <div className="flex-1 flex min-h-0">
          {/* Master list */}
          <div className="w-[400px] shrink-0 border-r border-white/10 bg-[#34373c] flex flex-col">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-400">
              <span>Sites · A–Z</span>
              <span>8 of 131</span>
            </div>
            <div className="flex-1 overflow-auto">
              {SITES.map((s, i) => (
                <button key={s.code} className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors ${i === 0 ? "bg-sky-500/10 border-l-2 border-l-sky-500" : "hover:bg-white/5"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-semibold text-sm">{s.code}</span>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${TONE[s.tone]}`}>{s.status}</span>
                  </div>
                  <div className="text-gray-200 text-sm truncate">{s.name}</div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-gray-400">
                    <span>{s.county}</span>
                    <span>{s.tickets} open · {s.vendor}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-auto p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-white text-2xl font-bold">{selected.code}</h2>
                  <span className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${TONE[selected.tone]}`}>{selected.status}</span>
                </div>
                <div className="text-gray-300 text-sm">{selected.name} · {selected.county}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 text-sm rounded-md bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 flex items-center gap-1.5"><QrCode className="w-4 h-4" />QR code</button>
                <button className="px-3 py-1.5 text-sm rounded-md bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 flex items-center gap-1.5"><Edit3 className="w-4 h-4" />Edit site</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="col-span-2 bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="text-white font-semibold text-sm mb-2">Location</div>
                <div className="aspect-[16/8] bg-[#2a2d31] border border-white/10 rounded-md relative overflow-hidden">
                  <FakeMap />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Lat / Lng</div>
                    <div className="text-white font-mono">31.3974, -101.5103</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Geofence</div>
                    <div className="text-white">500 m radius</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Last visit</div>
                    <div className="text-white">12 min ago</div>
                  </div>
                </div>
              </div>
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="text-white font-semibold text-sm mb-2 flex items-center gap-2"><Camera className="w-4 h-4 text-sky-400" />Wellhead photo</div>
                <div className="aspect-square bg-[#2a2d31] border border-white/10 rounded-md flex items-center justify-center text-[11px] text-gray-400">
                  wellhead-A41.jpg
                </div>
                <div className="text-[11px] text-gray-400 mt-2">Last updated by Ryan Foster · 2d ago</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white font-semibold text-sm">Assigned vendors</div>
                  <button className="text-[11px] text-sky-400 hover:underline">+ Assign</button>
                </div>
                {[
                  { name: "Permian Field Svc.", types: "Wireline · Workover", crew: 4 },
                  { name: "RedDirt Services", types: "Roustabout", crew: 2 },
                  { name: "Mid-Con Wireline", types: "Wireline (backup)", crew: 1 },
                ].map((v) => (
                  <div key={v.name} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div>
                      <div className="text-gray-100 text-sm font-medium">{v.name}</div>
                      <div className="text-[11px] text-gray-400">{v.types}</div>
                    </div>
                    <div className="text-[11px] text-gray-400">{v.crew} crew</div>
                  </div>
                ))}
              </div>
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white font-semibold text-sm">Recent tickets</div>
                  <button className="text-[11px] text-sky-400 hover:underline">View all</button>
                </div>
                {[
                  { id: "00021", status: "Pending review", t: "amber", crew: "Ryan Foster", when: "Today" },
                  { id: "00018", status: "Approved", t: "blue", crew: "Corey Blake", when: "Yesterday" },
                  { id: "00015", status: "Approved", t: "blue", crew: "Ryan Foster", when: "2d ago" },
                  { id: "00011", status: "Approved", t: "blue", crew: "Amy Nguyen", when: "5d ago" },
                ].map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 text-sm border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-gray-200">#{t.id}</span>
                      <span className="text-gray-400 text-xs">{t.crew}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${TONE[t.t === "blue" ? "emerald" : "amber"]}`}>{t.status}</span>
                      <span className="text-[11px] text-gray-400 w-16 text-right">{t.when}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
