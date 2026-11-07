import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { onboardingApi } from "@/lib/onboarding-api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface OnboardingAdminDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export function prefillAdminProfile(user: { displayName?: string; email: string | null; phone?: string | null }): OnboardingAdminDetails {
  const [firstName = "", ...lastName] = (user.displayName ?? "").trim().split(/\s+/);
  return { firstName, lastName: lastName.join(" "), email: user.email ?? "", phone: user.phone ?? "" };
}

export function OnboardingAdminProfile({ profile, onChange }: {
  profile: OnboardingAdminDetails;
  onChange: (profile: OnboardingAdminDetails) => void;
}) {
  const fields = [
    { key: "firstName", label: "First name", autoComplete: "given-name" },
    { key: "lastName", label: "Last name", autoComplete: "family-name" },
    { key: "email", label: "Email", type: "email", autoComplete: "email", fullWidth: true },
    { key: "phone", label: "Phone", type: "tel", autoComplete: "tel", fullWidth: true },
  ] as const;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Confirm Your Admin Profile</h2>
      <p className="text-sm text-gray-500">Your staff profile uses your existing login and organization administrator access. You can add staff and assign roles in Employee Management.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(field => (
          <div key={field.key} className={"fullWidth" in field ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`admin-profile-${field.key}`}>{field.label}</Label>
            <Input id={`admin-profile-${field.key}`} type={"type" in field ? field.type : "text"}
              autoComplete={field.autoComplete} value={profile[field.key]}
              onChange={event => onChange({ ...profile, [field.key]: event.target.value })} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function LeadAdminInvite({ orgType, orgId }: { orgType: "vendor" | "partner"; orgId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState(() => prefillAdminProfile({ email: null }));
  const { data: ownership } = useQuery({
    queryKey: ["onboarding-ownership", orgType, orgId],
    queryFn: ({ signal }) => onboardingApi.ownership(orgType, signal),
    enabled: open,
  });
  const [makeOwner, setMakeOwner] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <Popover open={open} onOpenChange={next => { setMessage(""); setMakeOwner(false); setConfirming(false); setOpen(next); }}>
        <PopoverTrigger asChild>
          <button type="button" className="vendor-mini-card-button onboarding-mini-card max-[440px]:w-full max-[440px]:!px-1">Add New Admin</button>
        </PopoverTrigger>
        <PopoverContent inline align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <form className="space-y-3" onSubmit={async event => {
            event.preventDefault();
            if (sending) return;
            if (makeOwner && !confirming) {
              setConfirming(true);
              return;
            }
            setSending(true);
            setMessage("");
            try {
              await onboardingApi.inviteLeadAdmin(orgType, { ...invite, makeOwner, confirmOwnership: confirming });
              setInvite(prefillAdminProfile({ email: null }));
              setOpen(false);
              setMakeOwner(false);
              setConfirming(false);
              toast({ title: "Lead Admin invitation sent" });
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not send the invitation.");
            } finally {
              setSending(false);
            }
          }}>
            <h3 className="font-semibold">Invite New Lead Admin</h3>
            <p className="text-sm">They’ll receive an email to accept administrator access. Your profile stays in place.</p>
            {([
              ["firstName", "First name", "text"],
              ["lastName", "Last name", "text"],
              ["email", "Email", "email"],
              ["phone", "Phone (optional)", "tel"],
            ] as const).map(([key, label, type]) => (
              <div key={key}>
                <Label htmlFor={`lead-admin-${key}`}>{label}</Label>
                <Input id={`lead-admin-${key}`} type={type} required={key !== "phone"}
                  value={invite[key]} readOnly={confirming} onChange={event => setInvite({ ...invite, [key]: event.target.value })} />
              </div>
            ))}
            {ownership?.canTransfer && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={makeOwner} disabled={confirming || sending}
                  onChange={event => setMakeOwner(event.target.checked)} />
                Make Owner
              </label>
            )}
            {confirming && <p role="alert" className="text-sm">
              Are you sure you want to transfer ownership to {invite.firstName} {invite.lastName} ({invite.email})?
              You’ll remain the owner until they accept through their email. Afterward, you’ll remain an administrator.
            </p>}
            {message && <p role="alert" className="text-sm">{message}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <OnboardingPillButton tone="secondary" disabled={sending} onClick={() => { if (confirming) setConfirming(false); else { setMakeOwner(false); setOpen(false); } }}>Cancel</OnboardingPillButton>
              <OnboardingPillButton type="submit" disabled={sending}>{sending ? "Sending…" : confirming ? "Confirm & Send Invitation" : "Send Invitation"}</OnboardingPillButton>
            </div>
          </form>
        </PopoverContent>
    </Popover>
  );
}