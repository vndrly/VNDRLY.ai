import { useTranslation } from "react-i18next";
import { ReturnToAdminPinDialog } from "@/components/return-to-admin-pin-dialog";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Pin, ArrowUp, ArrowDown, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { workHubRequest } from "@/lib/work-hub-client";
import {
  DEFAULT_WORK_HUB_PINS,
  getWorkHubNavItems,
  orderWorkHubItems,
  workHubIcons,
} from "@/lib/work-hub-nav";
import SidebarButton from "@/components/sidebar-button";
export type HubPreferences = {
  pinned: string[];
  order: string[];
  favorites: string[];
  muted: string[];
  drafts: Record<string, string>;
  lastConversationId: string | null;
};
const defaults: HubPreferences = {
  pinned: DEFAULT_WORK_HUB_PINS,
  order: [],
  favorites: [],
  muted: [],
  drafts: {},
  lastConversationId: null,
};
export function useHubPreferences(enabled = true) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["work-hub", "preferences", user?.userId];
  const query = useQuery<HubPreferences>({
    queryKey: key,
    queryFn: () => workHubRequest("/preferences"),
    enabled: enabled && !!user,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<HubPreferences>) => {
      const current = qc.getQueryData<HubPreferences>(key) ?? defaults;
      return workHubRequest<HubPreferences>("/preferences", {
        method: "PUT",
        body: JSON.stringify({ ...current, ...patch }),
      });
    },
    onSuccess: (result) => qc.setQueryData(key, result),
  });
  return { ...query, preferences: { ...defaults, ...query.data }, save };
}
export function WorkHubNavigation({ onNavigate, footer }: { onNavigate?: () => void; footer?: ReactNode }) {
  const [location] = useLocation();
  const brand = useBrand();
  const { user } = useAuth();
  const { t } = useTranslation();
  const office = canUseOfficeNavigation(user);
  const [unlocked, setCustomize] = useState(false);
  const customize = office && unlocked;
  const [pinAction, setPinAction] = useState<"admin" | "more" | null>(null);
  useEffect(() => { setCustomize(false); setPinAction(null); }, [user?.userId, user?.activeMembershipId, office]);
  const { preferences, save } = useHubPreferences();
  const items = orderWorkHubItems(
    getWorkHubNavItems(undefined, brand.name),
    preferences.order,
  );
  function move(key: string, delta: number) {
    const order = items.map((item) => item.key);
    const index = order.indexOf(key),
      target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    save.mutate({ order });
  }
  const render = (item: (typeof items)[number]) => {
    const Icon = workHubIcons[item.key as keyof typeof workHubIcons];
    const selected =
      location === item.href ||
      (item.href !== "/work-hub" && location.startsWith(item.href));
    return (
      <div key={item.key} className="relative">
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={selected ? "page" : undefined}
          data-testid={`nav-${item.key}`}
          className="block"
        >
          <SidebarButton
            isActive={selected}
            className={customize ? "pr-16" : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </SidebarButton>
        </Link>
        {customize && (
          <div className="absolute inset-y-0 right-2 z-20 flex items-center gap-0.5">
            <button
              className="grid h-5 w-5 place-items-center text-white disabled:text-white/35"
              aria-label={`${preferences.pinned.includes(item.key) ? "Unpin" : "Pin"} ${item.label}`}
              title="Pin to navigation"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  pinned: preferences.pinned.includes(item.key)
                    ? preferences.pinned.filter((k) => k !== item.key)
                    : [...preferences.pinned, item.key],
                })
              }
            >
              <Pin
                className={`h-3 w-3 ${preferences.pinned.includes(item.key) ? "fill-current" : ""}`}
              />
            </button>
            <button
              className="grid h-5 w-5 place-items-center text-white disabled:text-white/35"
              aria-label={`Move ${item.label} up`}
              disabled={save.isPending || items[0].key === item.key}
              onClick={() => move(item.key, -1)}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              className="grid h-5 w-5 place-items-center text-white disabled:text-white/35"
              aria-label={`Move ${item.label} down`}
              disabled={save.isPending || items.at(-1)?.key === item.key}
              onClick={() => move(item.key, 1)}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-0" aria-label="Work Hub navigation">
      {(customize
        ? items
        : items.filter((item) => preferences.pinned.includes(item.key))
      ).filter(item => item.key !== "askv").map(render)}
      {(customize || preferences.pinned.includes("askv")) && items.filter(item => item.key === "askv").map(render)}
      {office && <>
      <button type="button" className="block w-full text-left" onClick={() => setPinAction("admin")} data-testid="nav-go-to-admin">
        <SidebarButton isActive={false}><ArrowLeft className="h-4 w-4" />{t("gateNav.returnToAdmin")}</SidebarButton>
      </button>
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => customize ? setCustomize(false) : setPinAction("more")}
        aria-expanded={customize}
      >
        <SidebarButton isActive={false}>
          <MoreHorizontal className="h-4 w-4" />
          {customize ? "Done" : "More"}
        </SidebarButton>
      </button>
      <ReturnToAdminPinDialog open={pinAction !== null} onOpenChange={open => { if (!open) setPinAction(null); }}
        titleKey={pinAction === "more" ? "gateNav.more" : "gateNav.returnToAdmin"}
        onVerified={pinAction === "more" ? () => setCustomize(true) : undefined} />
      </>}
      {footer}
      {save.error && (
        <p role="alert" className="text-xs text-red-500">
          Navigation could not be saved. Try again.
        </p>
      )}
    </div>
  );
}
