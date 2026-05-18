import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type MembershipSummary } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

/**
 * Shown immediately after login when a user has 2+ memberships and has not
 * yet picked a remembered context (`requiresContextChoice` from the API).
 */
export default function ContextPickerModal() {
  const { user, switchContext } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<number | null>(null);

  if (!user || !user.requiresContextChoice || user.availableMemberships.length < 2) {
    return null;
  }

  const handlePick = async (m: MembershipSummary) => {
    setBusy(m.id);
    try {
      await switchContext(m.id);
      await queryClient.resetQueries();
      navigate("/");
    } catch (err) {
      toast({
        title: translateApiError(err, t, "Failed to choose context"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="context-picker-modal"
    >
      <div className="bg-card text-card-foreground rounded-xl shadow-2xl w-full max-w-md p-6 border border-border">
        <h2 className="text-xl font-bold mb-1" data-testid="text-context-picker-title">
          Choose your view
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          You belong to multiple organizations. Pick one to start with — you can
          switch any time from the sidebar.
        </p>
        <div className="space-y-2">
          {user.availableMemberships.map((m) => {
            const Icon = m.orgType === "partner" ? Building2 : Users;
            const accent = m.orgType === "partner" ? "border-blue-500/60 hover:bg-blue-500/10" : "border-amber-500/60 hover:bg-amber-500/10";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handlePick(m)}
                disabled={busy !== null}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors",
                  accent,
                  busy !== null && busy !== m.id && "opacity-50",
                )}
                data-testid={`button-pick-context-${m.id}`}
              >
                {m.orgLogoUrl ? (
                  <img
                    src={m.orgLogoUrl}
                    alt={`${m.orgName} logo`}
                    className="w-10 h-10 rounded object-contain bg-white/5 p-1 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 opacity-70" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{m.orgName}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {m.orgType} portal
                  </p>
                </div>
                {busy === m.id && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
