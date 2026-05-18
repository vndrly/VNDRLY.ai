import { ChevronLeft, MapPin, Wrench, ChevronDown, Camera, CheckCircle2, AlertTriangle } from "lucide-react";

export function NewTicket() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="h-1.5 bg-amber-500" />
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2">
        <button className="w-9 h-9 rounded-md flex items-center justify-center text-gray-600">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Step 1 of 3</p>
          <h1 className="text-base font-bold text-gray-900">New Ticket</h1>
        </div>
      </header>

      <div className="px-4 pt-3">
        <div className="flex gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-amber-500" />
          <div className="flex-1 h-1 rounded-full bg-gray-200" />
          <div className="flex-1 h-1 rounded-full bg-gray-200" />
        </div>
      </div>

      <div className="px-4 py-5 space-y-4">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Only sites & work types your office has approved for you will appear below.
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-amber-500" />
            Site Location
          </label>
          <button className="mt-1.5 w-full h-12 px-3 rounded-md border-2 border-amber-500 bg-white flex items-center justify-between shadow-sm">
            <div className="text-left min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">Permian Pad 14B</p>
              <p className="text-[11px] text-gray-500 truncate">Exxon Mobil · Midland, TX</p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
          <p className="text-[11px] text-gray-400 mt-1.5">3 approved sites · GPS auto-detected nearest</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-amber-500" />
            Work Type
          </label>
          <button className="mt-1.5 w-full h-12 px-3 rounded-md border-2 border-amber-500 bg-white flex items-center justify-between shadow-sm">
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">Wireline · Plug & Perf</p>
              <p className="text-[11px] text-gray-500">Approved by Exxon for this site</p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          <p className="text-[11px] text-gray-400 mt-1.5">2 approved work types for this site</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">PO / AFE Number (optional)</label>
          <input
            readOnly
            value="AFE-2026-04881"
            className="mt-1.5 w-full h-11 px-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Arrival Photo</label>
          <button className="mt-1.5 w-full h-20 rounded-md border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-1 text-gray-500">
            <Camera className="w-5 h-5" />
            <span className="text-[11px]">Tap to capture wellhead / BOP</span>
          </button>
        </div>

        <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-[11px] text-green-800">
            <span className="font-semibold">GPS confirmed:</span> 31.9974° N, 102.0779° W (within site radius)
          </p>
        </div>
      </div>

      <div className="mt-auto px-4 pb-6 pt-3 bg-white border-t border-gray-200">
        <button className="w-full h-12 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md">
          Check In & Start Ticket
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-2">
          Time, GPS, and your identity will be stamped on this ticket.
        </p>
      </div>
    </div>
  );
}
