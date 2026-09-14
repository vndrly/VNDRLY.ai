import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const WORK_PARTICIPATION_AUTHORIZATION_VERSION = "work-participation-2026-09";

type Status = {
  state: "pending" | "claimed" | "expired" | "revoked" | "invalid";
  username?: string;
  sponsorName?: string;
};

export default function ActivateAccount() {
  const [, navigate] = useLocation();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus({ state: "invalid" });
      return;
    }
    fetch(`${BASE}/api/implementation-a/account-invitations/activate/${encodeURIComponent(token)}`)
      .then(async (response) => response.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus({ state: "invalid" }));
  }, [token]);

  const ready = password.length >= 12 && password === confirm && authorized;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        `${BASE}/api/implementation-a/account-invitations/activate/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            password,
            authorizationVersion: WORK_PARTICIPATION_AUTHORIZATION_VERSION,
          }),
        },
      );
      if (!response.ok) throw new Error("Activation failed");
      setDone(true);
    } catch {
      setError("We could not activate this account. Ask your company administrator for a new link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 flex items-center justify-center">
      <section className="w-full max-w-lg rounded-2xl border-2 border-cyan-600 bg-white p-6 shadow-sm" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">VNDRLY account activation</p>
        {!status ? (
          <p className="mt-4 text-slate-600">Checking your secure invitation…</p>
        ) : done ? (
          <>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">Your account is ready</h1>
            <p className="mt-2 text-slate-600">Sign in with the password you just created to finish your employee profile.</p>
            <button className="mt-6 min-h-11 w-full rounded-xl bg-cyan-700 px-4 font-semibold text-white" onClick={() => navigate("/login")}>Continue to sign in</button>
          </>
        ) : status.state !== "pending" ? (
          <>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">This invitation is unavailable</h1>
            <p className="mt-2 text-slate-600">It may have expired, been revoked, or already been used. Ask your company administrator to resend it.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">{status.sponsorName} created your account</h1>
            <p className="mt-2 text-slate-600">Your username is <strong>{status.username}</strong>. Create your own password; VNDRLY never sends a temporary password.</p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <div>
                <Label htmlFor="activation-password">Create password</Label>
                <Input id="activation-password" aria-label="Create password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                <p className="mt-1 text-xs text-slate-500">Use at least 12 characters.</p>
              </div>
              <div>
                <Label htmlFor="activation-confirm">Confirm password</Label>
                <Input id="activation-confirm" aria-label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-slate-300 p-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-1 size-4" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} aria-label="Accept work participation authorization" />
                <span><strong>Work participation authorization.</strong> I accept my company&apos;s disclosed Work Hub participation, location, safety, and automatic meeting-transcription policies.</span>
              </label>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={!ready || submitting} className="min-h-11 w-full rounded-xl bg-cyan-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">{submitting ? "Activating…" : "Activate account"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
