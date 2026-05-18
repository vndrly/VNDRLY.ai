import {
  LayoutDashboard,
  ClipboardList,
  Map as MapIcon,
  Receipt,
  BookOpen,
  BarChart3,
  Settings,
  Bell,
  Search,
  Filter,
  Truck,
  Activity,
  Phone,
  MessageSquare,
  Navigation,
} from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: ClipboardList, label: "Tickets", badge: 12 },
  { icon: MapIcon, label: "Crew Map", active: true },
  { icon: Receipt, label: "Invoices" },
  { icon: BookOpen, label: "Catalog" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

const CREW = [
  { name: "Ryan Foster", site: "SITE-A41", state: "On site", color: "emerald", x: "62%", y: "38%" },
  { name: "Amy Nguyen", site: "SITE-B12", state: "Driving", color: "amber", x: "44%", y: "55%" },
  { name: "Daniel Ortiz", site: "SITE-C03", state: "On site", color: "emerald", x: "75%", y: "62%" },
  { name: "Corey Blake", site: "Off-shift", state: "Idle", color: "gray", x: "30%", y: "30%" },
  { name: "Patrick Gill", site: "SITE-D02", state: "Driving", color: "amber", x: "55%", y: "72%" },
];

const DOT: Record<string, string> = {
  emerald: "bg-emerald-500 ring-emerald-300/30",
  amber: "bg-amber-500 ring-amber-300/30",
  gray: "bg-gray-500 ring-gray-300/30",
};

function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 bg-[#2d3034] border-r border-white/10 flex flex-col">
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold">V</div>
        <div className="leading-tight">
          <div className="text-white text-sm font-semibold">VNDRLY</div>
          <div className="text-gray-400 text-[11px]">Vendor Portal</div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((n) => (
          <button key={n.label} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${n.active ? "bg-amber-500/15 text-white border border-amber-500/30" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}>
            <n.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{n.label}</span>
            {n.badge && <span className="text-[10px] bg-amber-500 text-black font-bold px-1.5 py-0.5 rounded-full">{n.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold">JD</div>
        <div className="leading-tight">
          <div className="text-white text-xs font-medium">Jordan Davis</div>
          <div className="text-gray-400 text-[10px]">Permian Field Svc.</div>
        </div>
      </div>
    </aside>
  );
}

function FakeMap() {
  // Stylized topo background w/ pseudo roads + site dots
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, #4a5258 0%, #2f3338 60%), radial-gradient(circle at 70% 80%, #3d434a 0%, transparent 60%)",
        }}
      />
      {/* Topo lines */}
      <svg className="absolute inset-0 w-full h-full opacity-20" preserveAspectRatio="none">
        {Array.from({ length: 10 }).map((_, i) => (
          <path
            key={i}
            d={`M 0 ${50 + i * 60} Q 200 ${20 + i * 60} 400 ${60 + i * 60} T 800 ${50 + i * 60} T 1200 ${40 + i * 60}`}
            stroke="#fff"
            strokeWidth="0.6"
            fill="none"
          />
        ))}
      </svg>
      {/* Roads */}
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <path d="M 0 350 L 800 380 L 900 200" stroke="#f59e0b" strokeWidth="2" fill="none" opacity="0.6" />
        <path d="M 200 0 L 220 300 L 600 600" stroke="#3b82f6" strokeWidth="2" fill="none" opacity="0.6" />
        <path d="M 100 700 L 700 500 L 1100 700" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.4" />
      </svg>
      {/* Site markers */}
      {CREW.map((c, i) => (
        <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: c.x, top: c.y }}>
          <div className={`w-4 h-4 rounded-full ${DOT[c.color]} ring-4 animate-pulse`} />
          <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded border border-white/10">
            {c.name.split(" ")[0]} · {c.site}
          </div>
        </div>
      ))}
    </div>
  );
}

export function VendorCrewMap() {
  return (
    <div className="w-full h-screen bg-[#3a3d42] flex overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-[#34373c] border-b border-white/10 px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-lg font-semibold">Crew Map</h1>
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              Live · 5 active
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input placeholder="Search crew or site…" className="bg-[#2a2d31] text-gray-200 text-sm rounded-md pl-8 pr-3 py-1.5 w-64 border border-white/10 focus:outline-none focus:border-amber-500/50 placeholder:text-gray-500" />
            </div>
            <Bell className="w-5 h-5 text-gray-300" />
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm">V</div>
          </div>
        </header>
        <div className="flex-1 relative min-h-0">
          <FakeMap />

          {/* Floating filter / list panel — left */}
          <div className="absolute top-4 left-4 w-72 bg-[#2a2d31]/95 backdrop-blur border border-white/10 rounded-lg shadow-xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-white text-sm font-semibold">Crew</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <button className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">On site</button>
                <button className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">Driving</button>
                <button className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white">Idle</button>
              </div>
            </div>
            <div className="max-h-[480px] overflow-auto">
              {CREW.map((c, i) => (
                <button key={i} className={`w-full text-left px-3 py-2.5 border-b border-white/5 last:border-0 transition-colors ${i === 0 ? "bg-amber-500/10" : "hover:bg-white/5"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${DOT[c.color]} ring-2`} />
                    <span className="text-white text-sm font-medium flex-1">{c.name}</span>
                    <span className="text-[10px] text-gray-400">{c.state}</span>
                  </div>
                  <div className="text-[11px] text-gray-300 ml-4 mt-0.5 flex items-center gap-1">
                    <Truck className="w-3 h-3" />{c.site}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Floating detail card — right (selected crew) */}
          <div className="absolute top-4 right-4 w-80 bg-[#2a2d31]/95 backdrop-blur border border-white/10 rounded-lg shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-semibold">RF</div>
                <div className="flex-1">
                  <div className="text-white font-semibold">Ryan Foster</div>
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1"><Activity className="w-3 h-3" />On site · 1h 22m</div>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Site</span><span className="text-white">SITE-A41 Reagan Co.</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Active ticket</span><span className="text-amber-400">#00021</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Last GPS</span><span className="text-white">12 sec ago</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Today's hrs</span><span className="text-white">7.2 hr</span></div>
            </div>
            <div className="grid grid-cols-3 gap-1 px-3 pb-3">
              <button className="flex flex-col items-center gap-1 py-2 rounded bg-white/5 hover:bg-white/10 text-gray-200 text-[10px]"><Phone className="w-4 h-4 text-amber-400" />Call</button>
              <button className="flex flex-col items-center gap-1 py-2 rounded bg-white/5 hover:bg-white/10 text-gray-200 text-[10px]"><MessageSquare className="w-4 h-4 text-amber-400" />Message</button>
              <button className="flex flex-col items-center gap-1 py-2 rounded bg-white/5 hover:bg-white/10 text-gray-200 text-[10px]"><Navigation className="w-4 h-4 text-amber-400" />Directions</button>
            </div>
          </div>

          {/* Bottom legend */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#2a2d31]/95 backdrop-blur border border-white/10 rounded-full px-4 py-2 flex items-center gap-4 text-[11px] text-gray-200">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />On site</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />Driving</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-500" />Idle</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-400">Updated 12s ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}
