import { Mail, Lock, HardHat } from "lucide-react";

export function Login() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="h-1.5 bg-amber-500" />
      <div className="flex-1 flex flex-col px-6 pt-10 pb-8">
        <div className="flex flex-col items-start mb-8">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center mb-4 shadow-lg">
            <HardHat className="w-8 h-8 text-white" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">Field Crew</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Sign in to VNDRLY</h1>
          <p className="text-sm text-gray-500 mt-1.5">Use the email and password your office gave you.</p>
        </div>

        <div className="border-2 border-amber-500 rounded-xl p-5 shadow-lg space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Email</label>
            <div className="mt-1.5 flex items-center gap-2 h-11 px-3 rounded-md border border-gray-300 bg-white">
              <Mail className="w-4 h-4 text-gray-400" />
              <input
                readOnly
                value="t.morales@precisionwell.com"
                className="flex-1 text-sm text-gray-900 bg-transparent outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Password</label>
            <div className="mt-1.5 flex items-center gap-2 h-11 px-3 rounded-md border border-gray-300 bg-white">
              <Lock className="w-4 h-4 text-gray-400" />
              <input
                readOnly
                value="••••••••••"
                className="flex-1 text-sm text-gray-900 bg-transparent outline-none"
              />
            </div>
          </div>
          <button className="w-full h-11 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm shadow-sm">
            Sign In
          </button>
          <div className="text-center">
            <a className="text-xs text-amber-600 underline underline-offset-2 font-medium">
              Forgot password? Email me a reset link
            </a>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            <span className="font-semibold text-gray-700">No login?</span> You can still scan your site's QR code to check in.
          </p>
        </div>

        <div className="mt-auto pt-8">
          <p className="text-[11px] text-gray-400 text-center">
            VNDRLY Field Operations · v2.4.1
          </p>
        </div>
      </div>
    </div>
  );
}
