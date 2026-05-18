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
  MapPin,
  User,
  Calendar,
  DollarSign,
  Paperclip,
  CheckCircle2,
  XCircle,
  MessageSquare,
} from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: ClipboardList, label: "Tickets", active: true, badge: 12 },
  { icon: MapIcon, label: "Crew Map" },
  { icon: Receipt, label: "Invoices" },
  { icon: BookOpen, label: "Catalog" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

const TICKETS = [
  { id: "00021", site: "SITE-A41 Reagan Co.", crew: "Ryan Foster", status: "Pending review", tone: "amber", when: "Today 09:42", price: "$8,420" },
  { id: "00020", site: "SITE-B12 Howard Co.", crew: "Amy Nguyen", status: "In progress", tone: "emerald", when: "Today 08:15", price: "$5,180" },
  { id: "00019", site: "SITE-C03 Blaine Co.", crew: "Daniel Ortiz", status: "In progress", tone: "emerald", when: "Today 07:55", price: "$3,940" },
  { id: "00018", site: "SITE-A28 Midland", crew: "Corey Blake", status: "Approved", tone: "blue", when: "Yesterday", price: "$11,205" },
  { id: "00017", site: "SITE-D02 Andrews", crew: "Patrick Gill", status: "Kicked back", tone: "red", when: "Yesterday", price: "$2,640" },
  { id: "00016", site: "SITE-A41 Reagan Co.", crew: "Safety Inspection", status: "Submitted", tone: "amber", when: "2d ago", price: "$1,375" },
  { id: "00015", site: "SITE-E07 Crane Co.", crew: "Ryan Foster", status: "Approved", tone: "blue", when: "2d ago", price: "$6,015" },
  { id: "00014", site: "SITE-B12 Howard Co.", crew: "Djon Tsu", status: "Approved", tone: "blue", when: "3d ago", price: "$4,810" },
];

const TONE: Record<string, string> = {
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  red: "bg-red-500/15 text-red-300 border-red-500/40",
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

function TopBar() {
  return (
    <header className="h-14 shrink-0 bg-[#34373c] border-b border-white/10 px-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-white text-lg font-semibold">Tickets</h1>
        <span className="text-[10px] text-gray-400">38 open · 4 awaiting review</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input placeholder="Search ticket #, site, crew…" className="bg-[#2a2d31] text-gray-200 text-sm rounded-md pl-8 pr-3 py-1.5 w-72 border border-white/10 focus:outline-none focus:border-amber-500/50 placeholder:text-gray-500" />
        </div>
        <button className="text-gray-300 hover:text-white text-sm flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10">
          <Filter className="w-3.5 h-3.5" />Filters
        </button>
        <Bell className="w-5 h-5 text-gray-300" />
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm">V</div>
      </div>
    </header>
  );
}

export function VendorTickets() {
  const selected = TICKETS[0];
  return (
    <div className="w-full h-screen bg-[#3a3d42] flex overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          {/* Master list */}
          <div className="w-[380px] shrink-0 border-r border-white/10 bg-[#34373c] flex flex-col">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-400">
              <span>Recent</span>
              <span>Sort: Newest</span>
            </div>
            <div className="flex-1 overflow-auto">
              {TICKETS.map((t, i) => (
                <button
                  key={t.id}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors ${i === 0 ? "bg-amber-500/10 border-l-2 border-l-amber-500" : "hover:bg-white/5"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-semibold text-sm">#{t.id}</span>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${TONE[t.tone]}`}>{t.status}</span>
                  </div>
                  <div className="text-gray-200 text-sm truncate">{t.site}</div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-gray-400">
                    <span>{t.crew}</span>
                    <span>{t.when} · {t.price}</span>
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
                  <h2 className="text-white text-2xl font-bold">Ticket #{selected.id}</h2>
                  <span className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full border ${TONE[selected.tone]}`}>{selected.status}</span>
                </div>
                <div className="text-gray-300 text-sm flex items-center gap-3">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-amber-400" />{selected.site}</span>
                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-amber-400" />{selected.crew}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-amber-400" />{selected.when}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 text-sm rounded-md bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 flex items-center gap-1.5"><XCircle className="w-4 h-4" />Kick back</button>
                <button className="px-3 py-1.5 text-sm rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />Approve</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Subtotal</div>
                <div className="text-white text-lg font-bold">$7,820.00</div>
              </div>
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Tax</div>
                <div className="text-white text-lg font-bold">$600.00</div>
              </div>
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Total</div>
                <div className="text-amber-400 text-lg font-bold">{selected.price}</div>
              </div>
            </div>

            <div className="bg-[#34373c] border border-white/10 rounded-lg overflow-hidden mb-4">
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
                <div className="text-white font-semibold text-sm">Line items</div>
                <button className="text-[11px] text-amber-400 hover:underline">+ Add line</button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-gray-400 bg-white/5">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Description</th>
                    <th className="text-left px-4 py-2 font-medium">Type</th>
                    <th className="text-right px-4 py-2 font-medium">Qty</th>
                    <th className="text-right px-4 py-2 font-medium">Rate</th>
                    <th className="text-right px-4 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {[
                    { d: "Wireline svc — std hours", t: "Labor", q: 8, r: 215, total: 1720 },
                    { d: "Wireline svc — overtime", t: "Labor", q: 2, r: 322, total: 644 },
                    { d: "Tubing — 2 7/8\"", t: "Parts", q: 12, r: 145, total: 1740 },
                    { d: "Mileage", t: "Travel", q: 184, r: 1.2, total: 220.8 },
                    { d: "Specialty rig setup", t: "Labor", q: 1, r: 3495, total: 3495 },
                  ].map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-4 py-2">{r.d}</td>
                      <td className="px-4 py-2 text-gray-400">{r.t}</td>
                      <td className="px-4 py-2 text-right">{r.q}</td>
                      <td className="px-4 py-2 text-right">${r.r.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-white font-medium">${r.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="text-white font-semibold text-sm mb-2 flex items-center gap-2"><Paperclip className="w-4 h-4 text-amber-400" />Attachments</div>
                <div className="grid grid-cols-3 gap-2">
                  {["wellhead.jpg", "before.jpg", "after.jpg", "scope.pdf", "dispatch.csv", "+2 more"].map((f) => (
                    <div key={f} className="aspect-video bg-[#2a2d31] border border-white/10 rounded flex items-center justify-center text-[10px] text-gray-300 px-1 text-center">{f}</div>
                  ))}
                </div>
              </div>
              <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
                <div className="text-white font-semibold text-sm mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-amber-400" />Notes & comments</div>
                <div className="space-y-2 text-sm">
                  <div className="bg-[#2a2d31] rounded p-2.5 border border-white/5">
                    <div className="text-[10px] text-gray-400 mb-0.5">Ryan Foster · 09:42</div>
                    <div className="text-gray-200">Wellhead pressure cycled twice during job, photos attached.</div>
                  </div>
                  <div className="bg-[#2a2d31] rounded p-2.5 border border-white/5">
                    <div className="text-[10px] text-gray-400 mb-0.5">Jordan Davis · 09:55</div>
                    <div className="text-gray-200">Approved scope expansion w/ partner via phone — see ticket #00018 ref.</div>
                  </div>
                  <input placeholder="Add a comment…" className="w-full bg-[#2a2d31] text-gray-200 text-sm rounded px-3 py-2 border border-white/10 focus:outline-none focus:border-amber-500/50" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
