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
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  Activity,
} from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: ClipboardList, label: "Tickets", badge: 12 },
  { icon: MapIcon, label: "Crew Map" },
  { icon: Receipt, label: "Invoices" },
  { icon: BookOpen, label: "Catalog" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 bg-[#2d3034] border-r border-white/10 flex flex-col">
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold">
          V
        </div>
        <div className="leading-tight">
          <div className="text-white text-sm font-semibold">VNDRLY</div>
          <div className="text-gray-400 text-[11px]">Vendor Portal</div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((n) => (
          <button
            key={n.label}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
              n.active
                ? "bg-amber-500/15 text-white border border-amber-500/30"
                : "text-gray-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <n.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{n.label}</span>
            {n.badge && (
              <span className="text-[10px] bg-amber-500 text-black font-bold px-1.5 py-0.5 rounded-full">
                {n.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold">
          JD
        </div>
        <div className="leading-tight">
          <div className="text-white text-xs font-medium">Jordan Davis</div>
          <div className="text-gray-400 text-[10px]">Permian Field Svc.</div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ title }: { title: string }) {
  return (
    <header className="h-14 shrink-0 bg-[#34373c] border-b border-white/10 px-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-white text-lg font-semibold">{title}</h1>
        <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
          Live
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search tickets, sites…"
            className="bg-[#2a2d31] text-gray-200 text-sm rounded-md pl-8 pr-3 py-1.5 w-64 border border-white/10 focus:outline-none focus:border-amber-500/50 placeholder:text-gray-500"
          />
        </div>
        <button className="relative text-gray-300 hover:text-white">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>
        <div className="text-right leading-tight">
          <div className="text-[10px] text-gray-400 italic">…powered by</div>
        </div>
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm">
          V
        </div>
      </div>
    </header>
  );
}

function Kpi({
  label,
  value,
  delta,
  positive,
  icon: Icon,
  tint,
}: {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: any;
  tint: string;
}) {
  return (
    <div className="bg-[#34373c] border border-white/10 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-gray-400">
          {label}
        </span>
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center"
          style={{ background: tint }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="text-white text-2xl font-bold">{value}</div>
      <div
        className={`flex items-center gap-1 text-[11px] ${
          positive ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {positive ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {delta} vs last week
      </div>
    </div>
  );
}

function ActivityRow({
  who,
  what,
  when,
  status,
}: {
  who: string;
  what: string;
  when: string;
  status: "ok" | "pending" | "review";
}) {
  const dot =
    status === "ok"
      ? "bg-emerald-500"
      : status === "pending"
        ? "bg-amber-500"
        : "bg-blue-500";
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className={`w-2 h-2 rounded-full mt-1.5 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">
          <span className="font-medium">{who}</span>{" "}
          <span className="text-gray-300">{what}</span>
        </div>
        <div className="text-[11px] text-gray-400">{when}</div>
      </div>
    </div>
  );
}

function ChartBars() {
  const bars = [42, 58, 39, 70, 55, 78, 65, 80, 60, 72, 88, 76, 82, 95];
  const max = Math.max(...bars);
  return (
    <div className="flex items-end gap-1.5 h-32 mt-3">
      {bars.map((b, i) => (
        <div
          key={i}
          className="flex-1 bg-gradient-to-t from-amber-600 to-amber-400 rounded-t"
          style={{ height: `${(b / max) * 100}%`, opacity: 0.55 + i / 30 }}
        />
      ))}
    </div>
  );
}

export function VendorDashboard() {
  return (
    <div className="w-full h-screen bg-[#3a3d42] flex overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title="Dashboard" />
        <main className="flex-1 overflow-auto p-5 space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <Kpi
              label="Open tickets"
              value="38"
              delta="+12%"
              positive
              icon={ClipboardList}
              tint="rgba(245,158,11,0.25)"
            />
            <Kpi
              label="Crew on site"
              value="14"
              delta="+2"
              positive
              icon={Activity}
              tint="rgba(16,185,129,0.25)"
            />
            <Kpi
              label="Avg. response"
              value="42m"
              delta="-8m"
              positive
              icon={Clock}
              tint="rgba(59,130,246,0.25)"
            />
            <Kpi
              label="Approved this wk"
              value="$184k"
              delta="+9%"
              positive
              icon={CheckCircle2}
              tint="rgba(16,185,129,0.25)"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-[#34373c] border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold">
                    Tickets completed
                  </div>
                  <div className="text-[11px] text-gray-400">
                    Last 14 days · all crews
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <button className="px-2 py-1 rounded bg-white/10 text-white">
                    14d
                  </button>
                  <button className="px-2 py-1 rounded text-gray-400 hover:text-white">
                    30d
                  </button>
                  <button className="px-2 py-1 rounded text-gray-400 hover:text-white">
                    90d
                  </button>
                </div>
              </div>
              <ChartBars />
            </div>
            <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
              <div className="text-white font-semibold mb-1">
                Recent activity
              </div>
              <div className="text-[11px] text-gray-400 mb-1">
                Crew + ticket events
              </div>
              <div>
                <ActivityRow
                  who="Ryan Foster"
                  what="checked in at SITE-A41"
                  when="2 min ago"
                  status="ok"
                />
                <ActivityRow
                  who="Ticket #00021"
                  what="awaiting partner approval"
                  when="14 min ago"
                  status="review"
                />
                <ActivityRow
                  who="Amy Nguyen"
                  what="submitted line items"
                  when="38 min ago"
                  status="pending"
                />
                <ActivityRow
                  who="Corey Blake"
                  what="closed ticket #00018"
                  when="1 hr ago"
                  status="ok"
                />
                <ActivityRow
                  who="Daniel Ortiz"
                  what="started travel to SITE-B12"
                  when="2 hr ago"
                  status="ok"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-semibold">Top sites</div>
                <button className="text-[11px] text-amber-400 hover:underline">
                  View all
                </button>
              </div>
              {[
                { name: "Reagan County, TX — Pad 41", val: "$48,210" },
                { name: "Howard County, TX — Pad 17", val: "$36,940" },
                { name: "Blaine County, OK — STACK 03", val: "$29,110" },
                { name: "Midland — Andrews 8", val: "$22,475" },
              ].map((s) => (
                <div
                  key={s.name}
                  className="flex justify-between py-1.5 text-sm border-b border-white/5 last:border-0"
                >
                  <span className="text-gray-200">{s.name}</span>
                  <span className="text-white font-medium">{s.val}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#34373c] border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-semibold">Open by status</div>
                <span className="text-[11px] text-gray-400">38 total</span>
              </div>
              {[
                { label: "In progress", n: 16, c: "bg-emerald-500" },
                { label: "Pending review", n: 12, c: "bg-amber-500" },
                { label: "Kicked back", n: 4, c: "bg-red-500" },
                { label: "Draft", n: 6, c: "bg-blue-500" },
              ].map((r) => (
                <div key={r.label} className="mb-2.5 last:mb-0">
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="text-gray-200">{r.label}</span>
                    <span className="text-white">{r.n}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${r.c}`}
                      style={{ width: `${(r.n / 38) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
