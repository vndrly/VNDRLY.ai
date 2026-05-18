import { useState } from "react";
import { Plus } from "lucide-react";
import { Pill } from "./Pill";

const ROLES = [
  "Operations Manager",
  "Drilling/Completions Engineer",
  "Procurement/Supply Chain",
  "Hotlist Coordinator",
  "Field Superintendent",
  "Company Man/Site Representative",
  "HSE/Safety Officer",
  "Ticket Approver",
  "Accounts Payable",
  "Account Owner/Executive Sponsor",
];

export function LogoCenteredTop() {
  const [selected, setSelected] = useState<string[]>([
    "Operations Manager",
    "Hotlist Coordinator",
  ]);
  const toggle = (r: string) =>
    setSelected((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-[480px] bg-white rounded-lg shadow-2xl border border-gray-200 p-6">
        {/* Header: logo centered above title; title stays left-aligned */}
        <div className="mb-4">
          <div className="flex justify-center mb-3">
            <img
              src="/__mockup/images/exxon-logo.png"
              alt="ExxonMobil"
              className="h-10 object-contain"
            />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Add Company Contact
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Job Title
            </label>
            <input
              type="text"
              placeholder="e.g. Operations Manager"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Company Roles
            </label>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">
              Select all roles this contact fills in your job workflow.
            </p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => {
                const active = selected.includes(r);
                return active ? (
                  <Pill key={r} size="sm" onClick={() => toggle(r)}>
                    {r}
                  </Pill>
                ) : (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggle(r)}
                    className="px-3 py-1 rounded-full text-xs font-medium border bg-gray-100 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <Pill size="md" fullWidth className="mt-2">
            <Plus className="w-4 h-4" />
            Add Company Contact
          </Pill>
        </div>
      </div>
    </div>
  );
}
