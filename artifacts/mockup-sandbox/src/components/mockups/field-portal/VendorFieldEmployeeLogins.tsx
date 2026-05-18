import { Search, Plus, MoreHorizontal, Mail, Key, ShieldCheck, ShieldAlert, HardHat, Filter } from "lucide-react";

const employees = [
  { name: "Tomás Morales",   email: "t.morales@precisionwell.com",  status: "active",   lastLogin: "2 min ago",     sites: 3, work: 2, badge: "Lead" },
  { name: "Dwayne Whitley",   email: "d.whitley@precisionwell.com",  status: "active",   lastLogin: "Today, 6:14 AM", sites: 2, work: 1 },
  { name: "Marcus Henley",    email: "m.henley@precisionwell.com",   status: "invited",  lastLogin: "Never",          sites: 1, work: 1 },
  { name: "Jordan Esparza",   email: "j.esparza@precisionwell.com",  status: "active",   lastLogin: "Yesterday",      sites: 4, work: 3 },
  { name: "Wesley Kang",      email: "w.kang@precisionwell.com",     status: "disabled", lastLogin: "Mar 22, 2026",   sites: 0, work: 0 },
  { name: "Ronnie Pace",      email: "r.pace@precisionwell.com",     status: "active",   lastLogin: "3 days ago",     sites: 2, work: 2 },
];

function StatusPill({ s }: { s: string }) {
  if (s === "active")   return <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-green-100 text-green-700"><ShieldCheck className="w-3 h-3" /> Active</span>;
  if (s === "invited")  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-700"><Mail className="w-3 h-3" /> Invite Sent</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-gray-200 text-gray-600"><ShieldAlert className="w-3 h-3" /> Disabled</span>;
}

export function VendorFieldEmployeeLogins() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-1.5 bg-amber-500" />
      <div className="max-w-[1180px] mx-auto px-8 py-6">
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
          <span>Vendor Admin</span>
          <span>/</span>
          <span>Precision Wellhead</span>
          <span>/</span>
          <span className="text-gray-900 font-semibold">Field Employee Logins</span>
        </div>

        <div className="flex items-end justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
              <HardHat className="w-6 h-6 text-amber-500" /> Field Employee Logins
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Create login credentials so your crew can sign in to the field portal directly — no QR code required.
            </p>
          </div>
          <button className="h-10 px-4 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm flex items-center gap-2 shadow-sm">
            <Plus className="w-4 h-4" /> Invite Field Employee
          </button>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-5">
          {[
            { label: "Active Logins",   value: "14", tone: "amber" },
            { label: "Invites Pending",  value: "2",  tone: "amber" },
            { label: "Disabled",         value: "3",  tone: "gray" },
            { label: "Used in last 7d",  value: "11", tone: "amber" },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-white border border-gray-200 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.tone === "amber" ? "text-amber-600" : "text-gray-900"}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-gray-50">
              <Search className="w-4 h-4 text-gray-400" />
              <input placeholder="Search by name or email" className="flex-1 text-sm bg-transparent outline-none" />
            </div>
            <button className="h-9 px-3 rounded-md border border-gray-200 text-sm text-gray-600 flex items-center gap-1.5">
              <Filter className="w-4 h-4" /> All Statuses
            </button>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Employee</th>
                <th className="text-left font-semibold px-4 py-2.5">Login Email</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Last Login</th>
                <th className="text-left font-semibold px-4 py-2.5">Approved Access</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e, i) => (
                <tr key={e.email} className={i % 2 ? "bg-white" : "bg-white"}>
                  <td className="px-4 py-3 border-t border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                        {e.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                          {e.name}
                          {e.badge && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{e.badge}</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 border-t border-gray-100 text-gray-700">{e.email}</td>
                  <td className="px-4 py-3 border-t border-gray-100"><StatusPill s={e.status} /></td>
                  <td className="px-4 py-3 border-t border-gray-100 text-gray-600">{e.lastLogin}</td>
                  <td className="px-4 py-3 border-t border-gray-100 text-gray-600">
                    <span className="font-semibold text-gray-900">{e.sites}</span> sites · <span className="font-semibold text-gray-900">{e.work}</span> work types
                  </td>
                  <td className="px-4 py-3 border-t border-gray-100 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button className="h-8 px-2.5 rounded-md border border-gray-200 text-xs text-gray-700 flex items-center gap-1 hover:bg-gray-50">
                        <Key className="w-3.5 h-3.5" /> Reset Password
                      </button>
                      <button className="h-8 w-8 rounded-md border border-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-50">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>Showing 6 of 19 employees</span>
            <div className="flex items-center gap-1">
              <button className="h-7 px-2.5 rounded border border-gray-200 text-gray-600">Prev</button>
              <button className="h-7 px-2.5 rounded border border-gray-200 text-gray-600">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
