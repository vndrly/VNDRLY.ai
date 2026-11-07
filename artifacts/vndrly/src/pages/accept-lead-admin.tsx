import { useState } from "react";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardingApi } from "@/lib/onboarding-api";

export default function AcceptLeadAdmin() {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const token = window.location.hash.slice(1);

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <section className="app-branded-flyout rounded-xl border p-6">
        <h1 className="mb-4 text-lg font-semibold">Lead Admin Invitation</h1>
        {accepted ? (
          <p role="status">Invitation accepted. <a href="/login">Continue to VNDRLY</a>.</p>
        ) : (
          <form className="space-y-4" onSubmit={async event => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError("");
            try {
              await onboardingApi.acceptLeadAdmin(token, password);
              window.history.replaceState(null, "", window.location.pathname);
              setPassword("");
              setAccepted(true);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Could not accept the invitation.");
            } finally {
              setPending(false);
            }
          }}>
            <p>Already have a VNDRLY account? <a className="underline" href="/login" target="_blank" rel="noopener">Sign in</a> with the invited email, then return here and accept.</p>
            <div>
              <Label htmlFor="lead-admin-password">New to VNDRLY? Choose a password</Label>
              <Input id="lead-admin-password" type="password" autoComplete="new-password" value={password}
                onChange={event => setPassword(event.target.value)} />
            </div>
            {error && <p role="alert">{error}</p>}
            <OnboardingPillButton type="submit" disabled={pending}>Accept Lead Admin Invitation</OnboardingPillButton>
          </form>
        )}
      </section>
    </main>
  );
}
