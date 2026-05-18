import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check, Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth, type MembershipSummary } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

interface Props {
  /** Active org name resolved by the parent (e.g. from useGetVendor/useGetPartner). */
  fallbackOrgName?: string | null;
}

export default function ContextSwitcher({ fallbackOrgName }: Props) {
  const { user, switchContext } = useAuth();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user || user.availableMemberships.length < 2) return null;

  const active =
    user.availableMemberships.find((m) => m.id === user.activeMembershipId) ??
    user.availableMemberships[0];

  const handlePick = async (m: MembershipSummary) => {
    if (m.id === user.activeMembershipId) {
      setOpen(false);
      return;
    }
    setBusyId(m.id);
    try {
      await switchContext(m.id);
      // Reset all server-derived caches so the dashboard, sidebar, hotlist,
      // etc. all refetch under the new context.
      await queryClient.resetQueries();
      navigate("/");
    } catch (err) {
      toast({
        title: translateApiError(err, t, "Failed to switch context"),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setOpen(false);
    }
  };

  const activeName = active.orgName || fallbackOrgName || "";
  const activeBadge = active.orgType === "partner" ? "Partner" : "Vendor";

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left",
          "hover:bg-sidebar-foreground/10 active:bg-sidebar-foreground/15 transition-colors",
        )}
        data-testid="button-context-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <OrgAvatar membership={active} size={32} />
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold text-sidebar-foreground/90 leading-tight truncate"
            data-testid="text-context-org-name"
          >
            {activeName}
          </p>
          <span
            className={cn(
              "inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded mt-0.5",
              active.orgType === "partner"
                ? "bg-blue-500/20 text-blue-200"
                : "bg-amber-500/20 text-amber-200",
            )}
            data-testid="badge-context-org-type"
          >
            {activeBadge}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-sidebar-foreground/70 transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute z-50 left-0 right-0 mt-1 rounded-md shadow-lg overflow-hidden",
            "bg-card text-card-foreground border border-border",
          )}
        >
          {user.availableMemberships.map((m) => {
            const isActive = m.id === user.activeMembershipId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handlePick(m)}
                disabled={busyId !== null}
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-2 hover-elevate active-elevate-2",
                  isActive && "bg-accent/40",
                )}
                data-testid={`option-context-${m.id}`}
              >
                <OrgAvatar membership={m} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.orgName}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {m.orgType}
                  </p>
                </div>
                {isActive && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Small square avatar that shows the org logo when available, falling
 * back to a partner/vendor icon. Used in both the sidebar pill and
 * the dropdown rows so a single-login user can visually tell partner
 * and vendor contexts apart at a glance.
 */
function OrgAvatar({
  membership,
  size,
}: {
  membership: MembershipSummary;
  size: number;
}) {
  const Icon = membership.orgType === "partner" ? Building2 : Users;
  const tint =
    membership.orgType === "partner"
      ? "bg-blue-500/20 text-blue-200"
      : "bg-amber-500/20 text-amber-200";
  if (membership.orgLogoUrl) {
    return (
      <img
        src={membership.orgLogoUrl}
        alt=""
        className="rounded object-cover shrink-0"
        style={{ width: size, height: size }}
        data-testid={`logo-context-${membership.id}`}
      />
    );
  }
  return (
    <div
      className={cn(
        "rounded flex items-center justify-center shrink-0",
        tint,
      )}
      style={{ width: size, height: size }}
      data-testid={`logo-context-${membership.id}-fallback`}
    >
      <Icon className="opacity-80" style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}
